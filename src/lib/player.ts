/**
 * Plays a voicemail as one continuous timeline, even when it is made of several segments
 * (a draft continued later). Uses a single <audio> element and the durations we measured while recording,
 * because browser-recorded webm files often report an unknown (Infinity) duration.
 */
import { db } from '../db/db';
import { markPlayed, segmentBlob } from '../db/repo';
import type { Voicemail } from '../db/types';
import { displayTitle } from './format';

export interface PlayerSnapshot {
  voicemailId: string | null;
  playing: boolean;
  positionMs: number;
  durationMs: number;
  rate: number;
  loading: boolean;
  error: string | null;
  /** true when trying again might help (a read or playback hiccup), false when there is simply no audio */
  canRetry: boolean;
  /** when playing a collection: where we are in it */
  queueIndex: number;
  queueLength: number;
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
    canRetry: false,
    queueIndex: 0,
    queueLength: 0,
  };
  private queue: Voicemail[] = [];
  private currentVm: Voicemail | null = null;
  private ready = false; // false until the first segment's audio is attached
  private artworkUrl: string | null = null;

  constructor() {
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.audio.addEventListener('timeupdate', () => {
      this.sync();
      this.updatePositionState();
    });
    this.setupMediaSession();
    this.audio.addEventListener('play', () => this.sync({ playing: true }));
    this.audio.addEventListener('pause', () => this.sync({ playing: false }));
    this.audio.addEventListener('ended', () => this.handleEnded());
    this.audio.addEventListener('error', () => {
      if (this.snap.voicemailId) this.sync({ error: "this voicemail couldn't be played on this device.", canRetry: true, playing: false });
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

  /** Play several voicemails one after another, like an album. */
  async playQueue(list: Voicemail[], start = 0) {
    const playable = list.filter((v) => !(v.unlockAt != null && v.unlockAt > Date.now()));
    if (!playable.length) return;
    this.queue = playable;
    await this.loadFromQueue(Math.min(start, playable.length - 1));
  }

  private async loadFromQueue(i: number) {
    const vm = this.queue[i];
    await this.load(vm, true);
    this.sync({ queueIndex: i, queueLength: this.queue.length });
    await this.play();
    await markPlayed(vm.id);
  }

  next() {
    const i = this.snap.queueIndex + 1;
    if (this.queue.length && i < this.queue.length) return this.loadFromQueue(i);
  }

  previous() {
    // like a music player: past the first few seconds, "previous" restarts the current one
    if (this.snap.positionMs > 3000 || this.snap.queueIndex === 0 || !this.queue.length) return this.seek(0);
    return this.loadFromQueue(this.snap.queueIndex - 1);
  }

  async load(vm: Voicemail, fromQueue = false) {
    if (!fromQueue) {
      // picking a single voicemail ends any collection that was playing
      this.queue = [];
      this.snap = { ...this.snap, queueIndex: 0, queueLength: 0 };
    }
    if (this.snap.voicemailId === vm.id) return;
    // never play a sealed future-me voicemail early, whatever screen asks
    if (vm.unlockAt != null && vm.unlockAt > Date.now()) return;
    this.audio.pause();
    this.release();
    let offset = 0;
    this.segments = vm.segments.map((s) => {
      const seg = { id: s.id, mimeType: s.mimeType, durationMs: s.durationMs, offsetMs: offset, url: null };
      offset += s.durationMs;
      return seg;
    });
    this.index = 0;
    this.currentVm = vm;
    this.ready = false;
    this.snap = { ...this.snap, voicemailId: vm.id, playing: false, positionMs: 0, durationMs: vm.durationMs, loading: true, error: null, canRetry: false };
    this.listeners.forEach((l) => l());
    if (!this.segments.length) {
      this.sync({ loading: false, error: 'this voicemail has no audio.', canRetry: false });
      return;
    }
    try {
      this.audio.src = await this.urlFor(0);
      this.ready = true;
    } catch {
      // reading the saved audio failed — nothing was changed, so trying again is safe
      this.sync({ loading: false, error: "couldn't read this voicemail's audio from your device.", canRetry: true });
      return;
    }
    this.audio.playbackRate = this.snap.rate;
    this.sync({ loading: false });
    this.updateMediaMetadata(vm).catch(() => {});
  }

  async play() {
    if (!this.segments.length || !this.ready) return; // keep the real error showing instead of a vaguer one
    if (this.snap.positionMs >= this.snap.durationMs - 50) await this.seek(0);
    try {
      this.audio.playbackRate = this.snap.rate;
      await this.audio.play();
    } catch (err) {
      if ((err as { name?: string }).name !== 'AbortError') this.sync({ error: 'tap play again to listen.', canRetry: true, playing: false });
    }
  }

  pause() {
    this.audio.pause();
  }

  /**
   * Try again after an error: rebuild the audio from what's saved and carry on from where it stopped.
   * Only reads — the recording and its details are never touched. Returns whether it's playable now.
   */
  async retry(): Promise<boolean> {
    const vm = this.currentVm;
    if (!vm) return false;
    const position = this.snap.positionMs;
    this.audio.pause();
    this.release();
    this.snap = { ...this.snap, voicemailId: null };
    await this.load(vm, true);
    const ok = !this.snap.error && (await this.waitForReady());
    if (!ok) {
      this.sync({ loading: false, error: "still can't play it. your recording is safe and hasn't been changed.", canRetry: true });
      return false;
    }
    this.sync({ error: null });
    if (position > 0) await this.seek(position);
    return true;
  }

  private waitForReady(timeoutMs = 5000): Promise<boolean> {
    const a = this.audio;
    if (a.error) return Promise.resolve(false);
    if (a.readyState >= 1) return Promise.resolve(true);
    return new Promise((resolve) => {
      const finish = (ok: boolean) => {
        clearTimeout(timer);
        a.removeEventListener('loadedmetadata', onOk);
        a.removeEventListener('error', onBad);
        resolve(ok);
      };
      const onOk = () => finish(true);
      const onBad = () => finish(false);
      const timer = setTimeout(() => finish(false), timeoutMs);
      a.addEventListener('loadedmetadata', onOk);
      a.addEventListener('error', onBad);
    });
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
    } else if (this.queue.length && this.snap.queueIndex < this.queue.length - 1) {
      await this.loadFromQueue(this.snap.queueIndex + 1);
    } else {
      this.sync({ playing: false, positionMs: this.snap.durationMs });
    }
  }

  // ---------------------------------------------------------------- lock screen & headphone controls

  private setupMediaSession() {
    const ms = typeof navigator !== 'undefined' ? navigator.mediaSession : undefined;
    if (!ms) return;
    const set = (action: MediaSessionAction, fn: MediaSessionActionHandler | null) => {
      try {
        ms.setActionHandler(action, fn);
      } catch {
        /* not every browser supports every action */
      }
    };
    set('play', () => this.play());
    set('pause', () => this.pause());
    set('seekbackward', (d) => this.skip(-(d.seekOffset ?? 10) * 1000));
    set('seekforward', (d) => this.skip((d.seekOffset ?? 10) * 1000));
    set('seekto', (d) => d.seekTime != null && this.seek(d.seekTime * 1000));
    set('previoustrack', () => this.previous());
    set('nexttrack', () => this.next());
  }

  private async updateMediaMetadata(vm: Voicemail) {
    const ms = navigator.mediaSession;
    if (!ms || typeof MediaMetadata === 'undefined') return;
    if (this.artworkUrl) URL.revokeObjectURL(this.artworkUrl);
    this.artworkUrl = null;
    const cover = vm.coverId ? await db.images.get(vm.coverId) : undefined;
    if (cover) this.artworkUrl = URL.createObjectURL(cover.blob);
    ms.metadata = new MediaMetadata({
      title: displayTitle(vm),
      artist: 'unspoken',
      album: 'for everything left unsaid.',
      artwork: [this.artworkUrl ? { src: this.artworkUrl, sizes: '1080x1080', type: cover!.blob.type || 'image/jpeg' } : { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
    });
  }

  private updatePositionState() {
    const ms = navigator.mediaSession;
    if (!ms?.setPositionState || !this.snap.durationMs) return;
    try {
      ms.setPositionState({
        duration: this.snap.durationMs / 1000,
        position: Math.min(this.snap.positionMs, this.snap.durationMs) / 1000,
        playbackRate: this.snap.rate,
      });
    } catch {
      /* ignore invalid states while switching */
    }
  }

  unload() {
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
    this.release();
    this.queue = [];
    this.snap = { ...this.snap, voicemailId: null, playing: false, positionMs: 0, durationMs: 0, error: null, canRetry: false, queueIndex: 0, queueLength: 0 };
    this.currentVm = null;
    if (navigator.mediaSession) navigator.mediaSession.metadata = null;
    this.listeners.forEach((l) => l());
  }
}

export const player = new SegmentedPlayer();
