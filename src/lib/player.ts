/**
 * Plays a voicemail as one continuous timeline, even when it is made of several segments
 * (a draft continued later). Uses a single <audio> element and the durations we measured while recording,
 * because browser-recorded webm files often report an unknown (Infinity) duration.
 */
import { segmentBlob } from '../db/repo';
import type { Voicemail } from '../db/types';

export interface PlayerSnapshot {
  voicemailId: string | null;
  playing: boolean;
  positionMs: number;
  durationMs: number;
  rate: number;
  loading: boolean;
  error: string | null;
}

interface LoadedSegment {
  id: string;
  mimeType: string;
  durationMs: number;
  offsetMs: number;
  url: string | null;
}

export class SegmentedPlayer {
  private audio: HTMLAudioElement;
  private segments: LoadedSegment[] = [];
  private index = 0;
  private listeners = new Set<() => void>();
  private snap: PlayerSnapshot = {
    voicemailId: null,
    playing: false,
    positionMs: 0,
    durationMs: 0,
    rate: 1,
    loading: false,
    error: null,
  };

  constructor() {
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.audio.addEventListener('timeupdate', () => this.sync());
    this.audio.addEventListener('play', () => this.sync({ playing: true }));
    this.audio.addEventListener('pause', () => this.sync({ playing: false }));
    this.audio.addEventListener('ended', () => this.handleEnded());
    this.audio.addEventListener('error', () => {
      if (this.snap.voicemailId) this.sync({ error: "this voicemail couldn't be played on this device.", playing: false });
    });
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  getSnapshot = (): PlayerSnapshot => this.snap;

  private sync(extra: Partial<PlayerSnapshot> = {}) {
    const seg = this.segments[this.index];
    const pos = seg ? seg.offsetMs + this.audio.currentTime * 1000 : 0;
    this.snap = { ...this.snap, positionMs: Math.min(pos, this.snap.durationMs || pos), ...extra };
    this.listeners.forEach((l) => l());
  }

  private async urlFor(i: number): Promise<string> {
    const s = this.segments[i];
    if (!s.url) s.url = URL.createObjectURL(await segmentBlob(s.id, s.mimeType));
    return s.url;
  }

  private release() {
    for (const s of this.segments) if (s.url) URL.revokeObjectURL(s.url);
    this.segments = [];
  }

  async load(vm: Voicemail) {
    if (this.snap.voicemailId === vm.id) return;
    this.audio.pause();
    this.release();
    let offset = 0;
    this.segments = vm.segments.map((s) => {
      const seg = { id: s.id, mimeType: s.mimeType, durationMs: s.durationMs, offsetMs: offset, url: null };
      offset += s.durationMs;
      return seg;
    });
    this.index = 0;
    this.snap = { ...this.snap, voicemailId: vm.id, playing: false, positionMs: 0, durationMs: vm.durationMs, loading: true, error: null };
    this.listeners.forEach((l) => l());
    if (!this.segments.length) {
      this.sync({ loading: false, error: 'this voicemail has no audio.' });
      return;
    }
    this.audio.src = await this.urlFor(0);
    this.audio.playbackRate = this.snap.rate;
    this.sync({ loading: false });
  }

  async play() {
    if (!this.segments.length) return;
    if (this.snap.positionMs >= this.snap.durationMs - 50) await this.seek(0);
    try {
      this.audio.playbackRate = this.snap.rate;
      await this.audio.play();
    } catch (err) {
      if ((err as { name?: string }).name !== 'AbortError') this.sync({ error: 'tap play again to listen.', playing: false });
    }
  }

  pause() {
    this.audio.pause();
  }

  toggle() {
    return this.audio.paused ? this.play() : (this.pause(), Promise.resolve());
  }

  async seek(ms: number) {
    if (!this.segments.length) return;
    const target = Math.max(0, Math.min(ms, this.snap.durationMs));
    let i = this.segments.findIndex((s) => target < s.offsetMs + s.durationMs);
    if (i === -1) i = this.segments.length - 1;
    const wasPlaying = !this.audio.paused;
    if (i !== this.index) {
      this.index = i;
      this.audio.src = await this.urlFor(i);
      this.audio.playbackRate = this.snap.rate;
    }
    const local = (target - this.segments[i].offsetMs) / 1000;
    await this.setTime(local);
    this.snap = { ...this.snap, positionMs: target };
    this.sync();
    if (wasPlaying) await this.play();
  }

  /** setting currentTime before metadata is ready is ignored by some browsers */
  private setTime(seconds: number): Promise<void> {
    return new Promise((resolve) => {
      const apply = () => {
        try {
          this.audio.currentTime = seconds;
        } catch {
          /* ignore */
        }
        resolve();
      };
      if (this.audio.readyState >= 1) apply();
      else this.audio.addEventListener('loadedmetadata', apply, { once: true });
    });
  }

  skip(deltaMs: number) {
    return this.seek(this.snap.positionMs + deltaMs);
  }

  setRate(rate: number) {
    this.audio.playbackRate = rate;
    this.sync({ rate });
  }

  private async handleEnded() {
    if (this.index < this.segments.length - 1) {
      this.index++;
      this.audio.src = await this.urlFor(this.index);
      this.audio.playbackRate = this.snap.rate;
      await this.audio.play().catch(() => {});
    } else {
      this.sync({ playing: false, positionMs: this.snap.durationMs });
    }
  }

  unload() {
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
    this.release();
    this.snap = { ...this.snap, voicemailId: null, playing: false, positionMs: 0, durationMs: 0, error: null };
    this.listeners.forEach((l) => l());
  }
}

export const player = new SegmentedPlayer();
