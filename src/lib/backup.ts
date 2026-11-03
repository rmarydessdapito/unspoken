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
const EXCLUDED_SETTINGS = new Set(['passcodeHash', 'passcodeSalt', 'biometricCredentialId']);

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
  const parts: Uint8Array[] = [];
  return {
    write: async (d) => {
      parts.push(d);
    },
    close: async () => new Blob(parts as BlobPart[], { type: 'application/zip' }),
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

  // read chunks one at a time so long recordings never sit in memory together
  for (const key of chunkKeys) {
    const c = await db.chunks.get(key);
    if (!c) continue;
    const file = `audio/${c.voicemailId}/${c.segmentId}-${String(c.seq).padStart(6, '0')}.bin`;
    manifest.chunks.push({ voicemailId: c.voicemailId, segmentId: c.segmentId, seq: c.seq, ms: c.ms, peaks: c.peaks, file, type: c.blob.type });
    await addFile(file, new Uint8Array(await c.blob.arrayBuffer()));
    onProgress({ done: ++done, total, label: 'packing your voice' });
  }
  for (const img of imageRows) {
    const file = `images/${img.id}.bin`;
    manifest.images.push({ id: img.id, createdAt: img.createdAt, file, type: img.blob.type });
    await addFile(file, new Uint8Array(await img.blob.arrayBuffer()));
    onProgress({ done: ++done, total, label: 'packing your photos' });
  }
  await addFile('manifest.json', strToU8(JSON.stringify(manifest)));
  onProgress({ done: ++done, total, label: 'almost there' });
  zip.end();
  await allWritten;
  return sink.close();
}

/** Restore from a backup .zip. Existing items with the same id are replaced; nothing else is removed. */
export async function importBackup(file: Blob, onProgress: (p: BackupProgress) => void): Promise<{ voicemails: number }> {
  const files = new Map<string, Uint8Array>();
  await new Promise<void>((resolve, reject) => {
    const unzip = new Unzip();
    unzip.register(UnzipPassThrough);
    unzip.register(UnzipInflate);
    let open = 0;
    let inputDone = false;
    const maybeDone = () => {
      if (inputDone && open === 0) resolve();
    };
    unzip.onfile = (f) => {
      open++;
      const parts: Uint8Array[] = [];
      f.ondata = (err, data, final) => {
        if (err) return reject(err);
        parts.push(data);
        if (final) {
          const len = parts.reduce((a, p) => a + p.length, 0);
          const out = new Uint8Array(len);
          let o = 0;
          for (const p of parts) {
            out.set(p, o);
            o += p.length;
          }
          files.set(f.name, out);
          open--;
          maybeDone();
        }
      };
      f.start();
    };
    (async () => {
      const reader = file.stream().getReader();
      let read = 0;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        read += value.length;
        unzip.push(value, false);
        onProgress({ done: read, total: file.size, label: 'opening your backup' });
      }
      unzip.push(new Uint8Array(0), true);
      inputDone = true;
      maybeDone();
    })().catch(reject);
  });

  const raw = files.get('manifest.json');
  if (!raw) throw new Error("this doesn't look like an unspoken backup.");
  const manifest = JSON.parse(strFromU8(raw)) as Manifest;
  if (manifest.format !== BACKUP_FORMAT) throw new Error("this doesn't look like an unspoken backup.");

  const total = manifest.chunks.length + manifest.images.length;
  let done = 0;
  const ids = new Set(manifest.voicemails.map((v) => v.id));
  // replace audio for voicemails being restored so chunks never duplicate
  await db.chunks
    .where('voicemailId')
    .anyOf([...ids])
    .delete();

  for (const c of manifest.chunks) {
    const data = files.get(c.file);
    if (!data) continue;
    await db.chunks.add({
      voicemailId: c.voicemailId,
      segmentId: c.segmentId,
      seq: c.seq,
      ms: c.ms,
      peaks: c.peaks,
      blob: new Blob([data as BlobPart], { type: c.type }),
    });
    onProgress({ done: ++done, total, label: 'putting your voice back' });
  }
  for (const i of manifest.images) {
    const data = files.get(i.file);
    if (!data) continue;
    await db.images.put({ id: i.id, createdAt: i.createdAt, blob: new Blob([data as BlobPart], { type: i.type }) });
    onProgress({ done: ++done, total, label: 'putting your photos back' });
  }
  await db.voicemails.bulkPut(manifest.voicemails.map((v) => (v.status === 'recording' ? { ...v, status: 'draft' as const } : v)));
  await db.collections.bulkPut(manifest.collections);
  await db.settings.bulkPut(manifest.settings.filter((s) => !EXCLUDED_SETTINGS.has(s.key)));
  return { voicemails: manifest.voicemails.length };
}
