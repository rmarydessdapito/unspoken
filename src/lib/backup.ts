/**
 * Backup & restore: everything (audio, artwork, photos, collections, settings) in one .zip you keep.
 *
 *  - Audio is stored uncompressed inside the zip (it's already compressed), so backups are fast.
 *  - Where the browser supports it (Chrome/Edge desktop), the zip streams straight to disk, so even
 *    many hours of audio don't need to fit in memory.
 *  - Lock settings (passcode, biometric) are intentionally NOT included in backups.
 */
import { Unzip, UnzipInflate, UnzipPassThrough, Zip, ZipPassThrough, strFromU8, strToU8 } from 'fflate';
import { db } from '../db/db';
import type { Chunk, Collection, StoredImage, Voicemail } from '../db/types';

export const BACKUP_FORMAT = 'unspoken-backup';
const EXCLUDED_SETTINGS = new Set(['passcodeHash', 'passcodeSalt', 'biometricCredentialId', 'failedUnlocks', 'lockoutUntil']);

export interface BackupProgress {
  done: number;
  total: number;
  label: string;
}

interface Manifest {
  format: string;
  version: 1;
  exportedAt: number;
  voicemails: Voicemail[];
  collections: Collection[];
  settings: { key: string; value: unknown }[];
  chunks: (Omit<Chunk, 'blob' | 'id'> & { file: string; type: string })[];
  images: (Omit<StoredImage, 'blob'> & { file: string; type: string })[];
}

export type Sink = { write(data: Uint8Array): Promise<void>; close(): Promise<Blob | null> };

async function makeSink(filename: string): Promise<Sink> {
  const picker = (globalThis as unknown as { showSaveFilePicker?: (o: unknown) => Promise<FileSystemFileHandle> }).showSaveFilePicker;
  if (picker) {
    try {
      const handle = await picker({ suggestedName: filename, types: [{ description: 'unspoken backup', accept: { 'application/zip': ['.zip'] } }] });
      const writable = await (handle as unknown as { createWritable(): Promise<FileSystemWritableFileStream> }).createWritable();
      return {
        write: (d) => writable.write(d as unknown as BufferSource),
        close: async () => {
          await writable.close();
          return null;
        },
      };
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') throw err;
      /* fall through to in-memory */
    }
  }
  return memorySink();
}

export function memorySink(): Sink {
  // small Blobs rather than raw bytes: the browser can keep them out of the page's memory
  const parts: Blob[] = [];
  return {
    write: async (d) => {
      parts.push(new Blob([d as BlobPart]));
    },
    close: async () => new Blob(parts, { type: 'application/zip' }),
  };
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Create a backup. Returns true when finished (saved to disk or downloaded). */
export async function exportBackup(onProgress: (p: BackupProgress) => void): Promise<boolean> {
  const date = new Date().toISOString().slice(0, 10);
  const filename = `unspoken-backup-${date}.zip`;
  const sink = await makeSink(filename);
  const blob = await writeBackup(sink, onProgress);
  if (blob) downloadBlob(blob, filename);
  await db.settings.put({ key: 'lastBackupAt', value: Date.now() });
  return true;
}

/** Stream the whole library as a zip into `sink`. Returns the blob for in-memory sinks. */
export async function writeBackup(sink: Sink, onProgress: (p: BackupProgress) => void = () => {}): Promise<Blob | null> {
  const [voicemails, collections, settings, chunkKeys, imageRows] = await Promise.all([
    db.voicemails.toArray(),
    db.collections.toArray(),
    db.settings.toArray(),
    db.chunks.toCollection().primaryKeys(),
    db.images.toArray(),
  ]);
  const total = chunkKeys.length + imageRows.length + 1;
  let done = 0;

  let pending: Promise<void> = Promise.resolve();
  let finished!: () => void;
  let failed!: (e: unknown) => void;
  const allWritten = new Promise<void>((res, rej) => {
    finished = res;
    failed = rej;
  });
  const zip = new Zip((err, data, final) => {
    if (err) return failed(err);
    pending = pending.then(() => sink.write(data));
    if (final) pending.then(finished, failed);
  });
  const addFile = async (name: string, data: Uint8Array) => {
    const f = new ZipPassThrough(name);
    zip.add(f);
    f.push(data, true);
    await pending; // backpressure: wait for the sink before reading more from the db
  };

  const manifest: Manifest = {
    format: BACKUP_FORMAT,
    version: 1,
    exportedAt: Date.now(),
    voicemails,
    collections,
    settings: settings.filter((s) => !EXCLUDED_SETTINGS.has(s.key)),
    chunks: [],
    images: [],
  };

  // the manifest goes first, so a restore can save each file the moment it's read instead of holding the whole backup in memory.
  // chunk records only point at their audio here; the audio itself is read one chunk at a time below.
  const fileFor = (c: { voicemailId: string; segmentId: string; seq: number }) => `audio/${c.voicemailId}/${c.segmentId}-${String(c.seq).padStart(6, '0')}.bin`;
  await db.chunks.each((c) => {
    manifest.chunks.push({ voicemailId: c.voicemailId, segmentId: c.segmentId, seq: c.seq, ms: c.ms, peaks: c.peaks, file: fileFor(c), type: c.blob.type });
  });
  for (const img of imageRows) manifest.images.push({ id: img.id, createdAt: img.createdAt, file: `images/${img.id}.bin`, type: img.blob.type });
  await addFile('manifest.json', strToU8(JSON.stringify(manifest)));

  for (const key of chunkKeys) {
    const c = await db.chunks.get(key);
    if (!c) continue;
    await addFile(fileFor(c), new Uint8Array(await c.blob.arrayBuffer()));
    onProgress({ done: ++done, total, label: 'packing your voice' });
  }
  for (const img of imageRows) {
    await addFile(`images/${img.id}.bin`, new Uint8Array(await img.blob.arrayBuffer()));
    onProgress({ done: ++done, total, label: 'packing your photos' });
  }
  onProgress({ done: ++done, total, label: 'almost there' });
  zip.end();
  await allWritten;
  return sink.close();
}

/**
 * Restore from a backup .zip. Voicemails in the backup replace any copy already here; nothing else is removed.
 *
 * Files are saved as they're read (the manifest comes first in backups made by this version), so even a backup
 * with hours of audio never has to fit in memory. Older backups, with the manifest last, are buffered instead.
 * Existing audio for the restored voicemails is only removed once the new audio is fully in — a restore that
 * fails halfway leaves everything as it was.
 */
export async function importBackup(file: Blob, onProgress: (p: BackupProgress) => void): Promise<{ voicemails: number }> {
  let manifest: Manifest | null = null;
  const waiting = new Map<string, Uint8Array>(); // files read before the manifest (older backups)
  let chunkMeta = new Map<string, Manifest['chunks'][number]>();
  let imageMeta = new Map<string, Manifest['images'][number]>();
  let oldChunkKeys: number[] = [];
  const addedChunkKeys: number[] = [];
  let writes: Promise<unknown> = Promise.resolve();
  let total = 1;
  let done = 0;

  const save = async (name: string, data: Uint8Array) => {
    const c = chunkMeta.get(name);
    if (c) {
      const key = await db.chunks.add({ voicemailId: c.voicemailId, segmentId: c.segmentId, seq: c.seq, ms: c.ms, peaks: c.peaks, blob: new Blob([data as BlobPart], { type: c.type }) });
      addedChunkKeys.push(key);
      onProgress({ done: ++done, total, label: 'putting your voice back' });
      return;
    }
    const i = imageMeta.get(name);
    if (i) {
      await db.images.put({ id: i.id, createdAt: i.createdAt, blob: new Blob([data as BlobPart], { type: i.type }) });
      onProgress({ done: ++done, total, label: 'putting your photos back' });
    }
  };

  const onManifest = async (raw: Uint8Array) => {
    let m: Manifest;
    try {
      m = JSON.parse(strFromU8(raw)) as Manifest;
    } catch {
      throw new Error("this doesn't look like an unspoken backup.");
    }
    if (m.format !== BACKUP_FORMAT || !Array.isArray(m.voicemails)) throw new Error("this doesn't look like an unspoken backup.");
    manifest = m;
    chunkMeta = new Map(m.chunks.map((c) => [c.file, c]));
    imageMeta = new Map(m.images.map((i) => [i.file, i]));
    total = m.chunks.length + m.images.length;
    oldChunkKeys = (await db.chunks
      .where('voicemailId')
      .anyOf(m.voicemails.map((v) => v.id))
      .primaryKeys()) as number[];
    for (const [name, data] of waiting) await save(name, data);
    waiting.clear();
  };

  try {
    await new Promise<void>((resolve, reject) => {
      const unzip = new Unzip();
      unzip.register(UnzipPassThrough);
      unzip.register(UnzipInflate);
      let open = 0;
      let inputDone = false;
      const maybeDone = () => {
        if (inputDone && open === 0) writes.then(() => resolve(), reject);
      };
      unzip.onfile = (f) => {
        open++;
        const parts: Uint8Array[] = [];
        f.ondata = (err, data, final) => {
          if (err) return reject(err);
          parts.push(data);
          if (!final) return;
          const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
          let o = 0;
          for (const p of parts) {
            out.set(p, o);
            o += p.length;
          }
          const name = f.name;
          writes = writes.then(() => (name === 'manifest.json' ? onManifest(out) : manifest ? save(name, out) : void waiting.set(name, out)));
          writes.catch(reject);
          open--;
          maybeDone();
        };
        f.start();
      };
      (async () => {
        const reader = file.stream().getReader();
        let read = 0;
        for (;;) {
          const { value, done: end } = await reader.read();
          if (end) break;
          read += value.length;
          unzip.push(value, false);
          await writes; // don't read faster than we can save
          if (!manifest) onProgress({ done: read, total: file.size, label: 'opening your backup' });
        }
        unzip.push(new Uint8Array(0), true);
        inputDone = true;
        maybeDone();
      })().catch(reject);
    });
    if (!manifest) throw new Error("this doesn't look like an unspoken backup.");
    // every piece of audio the backup lists must have arrived, or we'd be swapping good audio for a partial copy
    if (addedChunkKeys.length < (manifest as Manifest).chunks.length) throw new Error('incomplete backup');
  } catch (err) {
    // undo a half-finished restore: drop what we added, keep what was there
    await db.chunks.bulkDelete(addedChunkKeys);
    throw err instanceof Error && err.message.includes('unspoken backup') ? err : new Error("that backup couldn't be restored. nothing was changed.");
  }

  const m = manifest as Manifest;
  await db.transaction('rw', [db.chunks, db.voicemails, db.collections, db.settings], async () => {
    await db.chunks.bulkDelete(oldChunkKeys);
    await db.voicemails.bulkPut(m.voicemails.map((v) => (v.status === 'recording' ? { ...v, status: 'draft' as const } : v)));
    await db.collections.bulkPut(m.collections);
    await db.settings.bulkPut(m.settings.filter((s) => !EXCLUDED_SETTINGS.has(s.key)));
  });
  return { voicemails: m.voicemails.length };
}
