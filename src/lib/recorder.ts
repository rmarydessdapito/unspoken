/**
 * The recording engine.
 *
 * Reliability model:
 *  - MediaRecorder runs with a timeslice, so audio arrives in small chunks (every CHUNK_MS).
 *  - Every chunk is written to IndexedDB immediately, with its active duration and loudness peaks.
 *  - Pausing uses MediaRecorder.pause(): it's the SAME recording, paused time is never recorded,
 *    and we flush the pending chunk so nothing is held only in memory while paused.
 *  - If the tab closes or crashes, the voicemail is still marked "recording" in the database.
 *    On next launch `recoverInterruptedRecordings()` turns it into a draft — at most one chunk is lost.
 *  - There is no duration limit anywhere in this file.
 */
import { db, uid } from '../db/db';
import { newVoicemail, rebuildFromChunks, updateVoicemail } from '../db/repo';

export const CHUNK_MS = 2000;
export const PEAKS_PER_SECOND = 10;
/** Recordings shorter than this are treated as accidental taps, not kept. */
export const MIN_KEEP_MS = 1000;

export type RecorderState = 'idle' | 'starting' | 'recording' | 'paused' | 'stopping' | 'stopped';

export interface RecorderCallbacks {
  onState?: (s: RecorderState) => void;
  onLevel?: (level: number) => void;
  onInterrupted?: (voicemailId: string) => void;
  onError?: (message: string) => void;
}

const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/ogg;codecs=opus'];

export function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const m of MIME_CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(m)) return m;
    } catch {
      /* ignore */
    }
  }
  return '';
}

export function recordingSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';
}

/** 'granted' | 'denied' | 'prompt', or null when the browser can't tell us ahead of time (e.g. older Safari). */
export async function micPermission(): Promise<PermissionState | null> {
  try {
    return (await navigator.permissions.query({ name: 'microphone' as PermissionName })).state;
  } catch {
    return null;
  }
}

export function describeMicError(err: unknown): string {
  const name = (err as { name?: string })?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    return ios
      ? 'unspoken needs your microphone to listen. open settings → safari → microphone (or tap “aA” in the address bar → website settings) and allow it, then try again.'
      : 'unspoken needs your microphone to listen. tap the lock or settings icon next to the address bar, allow the microphone, then try again.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return "i couldn't find a microphone on this device.";
  if (name === 'NotReadableError') return 'another app seems to be using your microphone right now.';
  return "something went wrong starting the microphone. let's try again in a moment.";
}

export class VoicemailRecorder {
  state: RecorderState = 'idle';
  voicemailId = '';
  /** duration already in the voicemail before this session (when resuming a draft) */
  baseMs = 0;
  /** peaks recorded in earlier segments, for drawing the waveform continuously */
  priorPeaks: number[] = [];
  livePeaks: number[] = [];

  private cb: RecorderCallbacks;
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private levelTimer: ReturnType<typeof setInterval> | null = null;
  private segmentId = '';
  private mimeType = '';
  private seq = 0;
  private activeMs = 0;
  private resumedAt = 0;
  private lastChunkActiveMs = 0;
  private pendingPeaks: number[] = [];
  private writeQueue: Promise<unknown> = Promise.resolve();
  private stopResolve: (() => void) | null = null;
  private interrupted = false;

  constructor(cb: RecorderCallbacks = {}) {
    this.cb = cb;
  }

  /** Total elapsed recorded time, excluding paused time. */
  elapsedMs(): number {
    const live = this.state === 'recording' ? performance.now() - this.resumedAt : 0;
    return this.baseMs + this.activeMs + live;
  }

  private setState(s: RecorderState) {
    this.state = s;
    this.cb.onState?.(s);
  }

  /** Start a new voicemail, or continue an existing draft when `draftId` is given. */
  async start(opts: { draftId?: string; prompt?: string | null } = {}): Promise<string> {
    if (this.state !== 'idle') throw new Error('recorder already started');
    this.setState('starting');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
    } catch (err) {
      this.setState('idle');
      throw err;
    }

    this.mimeType = pickMimeType();
    const options: MediaRecorderOptions = { audioBitsPerSecond: 96_000 };
    if (this.mimeType) options.mimeType = this.mimeType;
    this.recorder = new MediaRecorder(this.stream, options);
    this.mimeType = this.recorder.mimeType || this.mimeType || 'audio/webm';
    this.segmentId = uid();

    if (opts.draftId) {
      const vm = await rebuildFromChunks(opts.draftId);
      if (!vm) throw new Error('that unfinished thought could not be found');
      this.voicemailId = vm.id;
      this.baseMs = vm.durationMs;
      this.priorPeaks = vm.peaks;
      await updateVoicemail(vm.id, {
        status: 'recording',
        segments: [...vm.segments, { id: this.segmentId, mimeType: this.mimeType, durationMs: 0 }],
      });
    } else {
      const vm = newVoicemail({
        prompt: opts.prompt ?? null,
        segments: [{ id: this.segmentId, mimeType: this.mimeType, durationMs: 0 }],
      });
      await db.voicemails.add(vm);
      this.voicemailId = vm.id;
    }

    this.setupAnalyser();
    this.recorder.ondataavailable = (e) => this.handleChunk(e.data);
    this.recorder.onstop = () => {
      this.stopResolve?.();
    };
    this.recorder.onerror = () => this.handleInterruption();
    for (const t of this.stream.getAudioTracks()) t.onended = () => this.handleInterruption();

    this.recorder.start(CHUNK_MS);
    this.resumedAt = performance.now();
    this.setState('recording');
    return this.voicemailId;
  }

  private setupAnalyser() {
    if (!this.stream) return;
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioCtx = new Ctx();
      const src = this.audioCtx.createMediaStreamSource(this.stream);
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 1024;
      src.connect(this.analyser);
    } catch {
      this.analyser = null; // waveform is a nicety; recording still works without it
    }
    const buf = new Float32Array(1024);
    this.levelTimer = setInterval(() => {
      if (this.state !== 'recording') return;
      let level = 0;
      if (this.analyser) {
        this.analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        const rms = Math.sqrt(sum / buf.length);
        // perceptual-ish curve so quiet speech is still visible
        level = Math.min(1, Math.pow(rms * 4, 0.6));
      }
      this.pendingPeaks.push(Number(level.toFixed(3)));
      this.livePeaks.push(level);
      this.cb.onLevel?.(level);
    }, 1000 / PEAKS_PER_SECOND);
  }

  private currentActiveMs(): number {
    return this.activeMs + (this.state === 'recording' ? performance.now() - this.resumedAt : 0);
  }

  private handleChunk(blob: Blob) {
    const active = this.currentActiveMs();
    const ms = Math.max(0, Math.round(active - this.lastChunkActiveMs));
    this.lastChunkActiveMs = active;
    const peaks = this.pendingPeaks;
    this.pendingPeaks = [];
    if (!blob || blob.size === 0) {
      if (ms === 0) return;
    }
    const seq = this.seq++;
    const voicemailId = this.voicemailId;
    const segmentId = this.segmentId;
    const total = Math.round(this.baseMs + active);
    this.writeQueue = this.writeQueue
      .then(async () => {
        await db.chunks.add({ voicemailId, segmentId, seq, blob, ms, peaks });
        await db.voicemails.update(voicemailId, { durationMs: total, updatedAt: Date.now() });
      })
      .catch((err) => {
        console.error('failed to persist audio chunk', err);
        const quota = (err as { name?: string })?.name === 'QuotaExceededError';
        this.cb.onError?.(
          quota
            ? "your device is running out of space. i've kept everything so far — finish or pause to be safe."
            : "i'm having trouble saving audio right now.",
        );
      });
  }

  pause() {
    if (this.state !== 'recording' || !this.recorder) return;
    this.recorder.pause();
    this.activeMs += performance.now() - this.resumedAt;
    this.setState('paused');
    // flush what we have so the paused recording is fully on disk
    try {
      this.recorder.requestData();
    } catch {
      /* some browsers throw if no data yet */
    }
  }

  resume() {
    if (this.state !== 'paused' || !this.recorder) return;
    this.recorder.resume();
    this.resumedAt = performance.now();
    this.setState('recording');
  }

  /** Ask for any buffered audio to be written now (e.g. when the page is being hidden). */
  flush() {
    if (this.recorder && this.recorder.state !== 'inactive') {
      try {
        this.recorder.requestData();
      } catch {
        /* ignore */
      }
    }
  }

  private async stopRecorder() {
    if (!this.recorder) return;
    if (this.state === 'recording') this.activeMs += performance.now() - this.resumedAt;
    this.setState('stopping');
    if (this.recorder.state !== 'inactive') {
      const stopped = new Promise<void>((r) => (this.stopResolve = r));
      this.recorder.stop();
      await Promise.race([stopped, new Promise((r) => setTimeout(r, 3000))]);
    }
    await this.writeQueue;
    this.teardown();
  }

  private teardown() {
    if (this.levelTimer) clearInterval(this.levelTimer);
    this.levelTimer = null;
    this.stream?.getTracks().forEach((t) => {
      t.onended = null;
      t.stop();
    });
    this.stream = null;
    this.audioCtx?.close().catch(() => {});
    this.audioCtx = null;
    this.setState('stopped');
  }

  /** Finish: the voicemail becomes a saved entry in "my unspoken". */
  async finish(): Promise<string> {
    await this.stopRecorder();
    const vm = await rebuildFromChunks(this.voicemailId);
    const sessionMs = (vm?.durationMs ?? 0) - this.baseMs;
    if (!vm || sessionMs < MIN_KEEP_MS) {
      if (this.baseMs === 0) {
        // a brand-new recording under a second long: nothing worth keeping, and no empty draft left behind
        await this.discardData();
        throw new Error("that was too short to keep, so nothing was saved.");
      }
      // continuing a draft and finishing straight away: keep what was there, drop the blip
      await this.dropThisSession();
    }
    await updateVoicemail(this.voicemailId, { status: 'saved' });
    return this.voicemailId;
  }

  /** Keep it as an unfinished thought to continue later. */
  async saveDraft(): Promise<string> {
    await this.stopRecorder();
    const vm = await rebuildFromChunks(this.voicemailId);
    if (!vm || vm.durationMs - this.baseMs < MIN_KEEP_MS) {
      if (this.baseMs === 0) {
        await this.discardData();
        return '';
      }
      await this.dropThisSession();
    }
    await updateVoicemail(this.voicemailId, { status: 'draft' });
    return this.voicemailId;
  }

  /** Remove only the audio recorded since this session started (used for blips under a second). */
  private async dropThisSession() {
    await db.chunks.where('segmentId').equals(this.segmentId).delete();
    const vm = await db.voicemails.get(this.voicemailId);
    if (vm) await updateVoicemail(vm.id, { segments: vm.segments.filter((x) => x.id !== this.segmentId) });
    await rebuildFromChunks(this.voicemailId);
  }

  /** Throw away only what this session recorded. A resumed draft keeps its earlier audio. */
  async discardSession() {
    await this.stopRecorder();
    await db.chunks.where('segmentId').equals(this.segmentId).delete();
    if (this.baseMs > 0) {
      const vm = await db.voicemails.get(this.voicemailId);
      if (vm) await updateVoicemail(vm.id, { segments: vm.segments.filter((s) => s.id !== this.segmentId) });
      await rebuildFromChunks(this.voicemailId);
      await updateVoicemail(this.voicemailId, { status: 'draft' });
    } else {
      await this.discardData();
    }
  }

  private async discardData() {
    await db.chunks.where('voicemailId').equals(this.voicemailId).delete();
    await db.voicemails.delete(this.voicemailId);
  }

  private async handleInterruption() {
    if (this.interrupted || this.state === 'stopping' || this.state === 'stopped') return;
    this.interrupted = true;
    try {
      await this.saveDraft();
    } finally {
      this.cb.onInterrupted?.(this.voicemailId);
    }
  }
}
