/**
 * Turning a voicemail into a single downloadable / shareable audio file.
 * - One segment (the usual case, including paused-and-resumed recordings): the original file, untouched.
 * - Several segments (a draft continued on another day): decoded and joined into one WAV file.
 */
import fixWebmDuration from 'fix-webm-duration';
import { segmentBlob } from '../db/repo';
import type { Voicemail } from '../db/types';
import { displayTitle } from './format';

export function extensionFor(mime: string): string {
  if (mime.includes('mp4') || mime.includes('aac')) return 'm4a';
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('wav')) return 'wav';
  return 'webm';
}

function safeName(s: string) {
  return (
    s
      .replace(/[^\p{L}\p{N} _-]+/gu, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 60) || 'voicemail'
  );
}

function encodeWav(channels: Float32Array[], sampleRate: number): Blob {
  const length = channels[0].length;
  const numCh = channels.length;
  const buffer = new ArrayBuffer(44 + length * numCh * 2);
  const view = new DataView(buffer);
  const write = (o: number, s: string) => [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
  write(0, 'RIFF');
  view.setUint32(4, 36 + length * numCh * 2, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numCh, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numCh * 2, true);
  view.setUint16(32, numCh * 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, length * numCh * 2, true);
  let o = 44;
  for (let i = 0; i < length; i++) {
    for (let ch = 0; ch < numCh; ch++) {
      const s = Math.max(-1, Math.min(1, channels[ch][i]));
      view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

export async function voicemailAudioFile(vm: Voicemail): Promise<File> {
  const base = safeName(displayTitle(vm));
  if (vm.segments.length === 1) {
    const s = vm.segments[0];
    let blob = await segmentBlob(s.id, s.mimeType);
    // recorded webm files don't say how long they are; write the length in so other players can show it and skip around
    if (s.mimeType.includes('webm')) {
      try {
        blob = await fixWebmDuration(blob, vm.durationMs, { logger: false });
      } catch {
        /* the original file still plays fine without it */
      }
    }
    return new File([blob], `${base}.${extensionFor(s.mimeType)}`, { type: s.mimeType.split(';')[0] });
  }
  const sampleRate = 24_000; // plenty for voice, keeps WAV size reasonable
  const ctx = new OfflineAudioContext(1, 1, sampleRate);
  const pieces: Float32Array[] = [];
  for (const s of vm.segments) {
    const blob = await segmentBlob(s.id, s.mimeType);
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    const mono = new Float32Array(decoded.length);
    for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
      const d = decoded.getChannelData(ch);
      for (let i = 0; i < d.length; i++) mono[i] += d[i] / decoded.numberOfChannels;
    }
    pieces.push(mono);
  }
  const total = pieces.reduce((a, p) => a + p.length, 0);
  const joined = new Float32Array(total);
  let o = 0;
  for (const p of pieces) {
    joined.set(p, o);
    o += p.length;
  }
  return new File([encodeWav([joined], sampleRate)], `${base}.wav`, { type: 'audio/wav' });
}

export function canShareFiles(file: File): boolean {
  try {
    return !!navigator.canShare?.({ files: [file] });
  } catch {
    return false;
  }
}
