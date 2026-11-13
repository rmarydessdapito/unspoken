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
import { forgetErased, getErasedIds, rebuildFromChunks, RESTORE_JOURNAL_KEY, undoRestoreFromJournal, type RestoreJournal } from '../db/repo';
import type { Chunk, Collection, StoredImage, Voicemail } from '../db/types';

export const BACKUP_FORMAT = 'unspoken-backup';
/** never written to a backup: lock settings, plus this device's own bookkeeping */
const EXCLUDED_SETTINGS = new Set(['passcodeHash', 'passcodeSalt', 'biometricCredentialId', 'failedUnlocks', 'lockoutUntil', 'erasedIds', RESTORE_JOURNAL_KEY]);
/** the only settings a restore may bring back (and only when the person asks); nothing about security is here */
const RESTORABLE_SETTINGS = ['onboarded', 'name', 'birthday', 'soundEffects', 'haptics', 'liveTranscription', 'remindersEnabled', 'reminderTime', 'libraryView', 'librarySort', 'collectionSort', 'echoFrequency', 'neverEcho'] as const;
/** the text-like details "use the backup's details" may replace; audio, photos and status are never touched */
const DETAIL_FIELDS = ['title', 'description', 'mood', 'tags', 'transcript', 'transcriptVisible', 'recordedAt', 'prompt', 'unlockAt'] as const;

export interface BackupProgress {
  done: number;
  total: number;
  label: string;
}

export interface Manifest {
  format: string;
  version: 1;
  exportedAt: number;
  voicemails: Voicemail[];
  collections: Collection[];
  settings: { key: string; value: unknown }[];
  chunks: (Omit<Chunk, 'blob' | 'id'> & { file: string; type: string })[];
  images: (Omit<StoredImage, 'blob'> & { file: string; type: string })[];
}

export type Sink = { write(data: Uint8Array): Promise<void>; close(): Promise<Blob | null>; abort?(): Promise<void> };

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
        // a failed backup must not leave a half-written file where the person chose to save it
        abort: () => writable.abort().catch(() => {}),
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
  let blob: Blob | null;
  try {
    blob = await writeBackup(sink, onProgress);
  } catch (err) {
    await sink.abort?.();
    throw err;
  }
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

// ------------------------------------------------------------------------------------------------ restore
//
// Restoring is an add-only merge. By default nothing that's on this device is deleted or replaced.
// It happens in two steps so nothing changes until the person has seen what will happen:
//   1. analyzeBackup()  reads and validates the backup and works out a preview. It changes nothing.
//   2. restoreBackup()  applies the chosen options. Everything it adds is journaled first, and on any failure
//                       (or a crash, at next start) every addition is undone.

export interface RestoreOptions {
  /** bring back voicemails and collections that aren't on this device (and have no record of being erased) */
  includeMissing: boolean;
  /** also bring back ones this device knows were erased for good */
  includeErased: boolean;
  /** for voicemails edited more recently in the backup, use its title, notes, mood, tags and transcript */
  useBackupDetails: boolean;
  /** bring back preferences (never passcode or other security settings) */
  restoreSettings: boolean;
}

export type PlanKind = 'new' | 'erased' | 'recover' | 'same' | 'trashed-here' | 'trashed-backup' | 'no-audio';

export interface PlanItem {
  id: string;
  title: string;
  kind: PlanKind;
  durationMs: number;
  /** will be added or changed under the current options */
  included: boolean;
  recoverChunks: number;
  newer: boolean;
}

export interface RestoreSummary {
  /** voicemails added */
  added: number;
  /** voicemails already here that get missing audio or photos back */
  recovered: number;
  recoveredPieces: number;
  /** voicemails whose details are replaced by the backup's */
  replaced: number;
  /** voicemails here that are kept exactly as they are */
  retained: number;
  collectionsAdded: number;
  collectionMembersAdded: number;
  settingsToRestore: number;
  skipped: {
    trashedInBackup: number;
    trashedHere: number;
    erased: number;
    notOnThisDevice: number;
    noAudio: number;
    erasedCollections: number;
    otherCollections: number;
  };
}

export interface RestorePlan {
  exportedAt: number;
  /** nothing at all is on this device yet, so restoring everything is the natural default */
  freshDevice: boolean;
  items: PlanItem[];
  summary: RestoreSummary;
  /** how many of the backup's preferences differ from this device's */
  settingsDiffer: number;
  /** opt-ins that would change something, so the screen only offers choices that matter */
  available: { missing: number; erased: number; newer: number; settings: number };
  defaults: RestoreOptions;
  manifest: Manifest;
}

interface LocalState {
  voicemails: Map<string, Voicemail>;
  chunkKeys: Set<string>;
  imageIds: Set<string>;
  collections: Map<string, Collection>;
  erased: Set<string>;
  settings: Map<string, unknown>;
  fresh: boolean;
}

const chunkKey = (segmentId: string, seq: number) => `${segmentId}|${seq}`;

async function loadLocalState(): Promise<LocalState> {
  const [voicemails, collections, settings, imageIds, erased, chunkKeys] = await Promise.all([
    db.voicemails.toArray(),
    db.collections.toArray(),
    db.settings.toArray(),
    db.images.toCollection().primaryKeys(),
    getErasedIds(),
    db.chunks.orderBy('[segmentId+seq]').keys(),
  ]);
  return {
    voicemails: new Map(voicemails.map((v) => [v.id, v])),
    collections: new Map(collections.map((c) => [c.id, c])),
    settings: new Map(settings.map((r) => [r.key, r.value])),
    imageIds: new Set(imageIds as string[]),
    erased,
    chunkKeys: new Set((chunkKeys as unknown as [string, number][]).map(([seg, seq]) => chunkKey(seg, seq))),
    fresh: voicemails.length === 0 && collections.length === 0 && chunkKeys.length === 0,
  };
}

const NOT_A_BACKUP = "this doesn't look like an unspoken backup.";
const DAMAGED = 'this backup looks damaged, so nothing was changed.';

/** Check a manifest's shape before anything is trusted. Throws a plain-language error. */
export function validateManifest(raw: unknown): Manifest {
  const m = raw as Partial<Manifest> | null;
  if (!m || typeof m !== 'object' || m.format !== BACKUP_FORMAT || !Array.isArray(m.voicemails)) throw new Error(NOT_A_BACKUP);
  if ((m as { version?: number }).version !== 1) throw new Error('this backup was made by a different version of unspoken, so it can’t be restored here safely. nothing was changed.');
  if (!Array.isArray(m.collections) || !Array.isArray(m.settings) || !Array.isArray(m.chunks) || !Array.isArray(m.images)) throw new Error(DAMAGED);
  const isStr = (x: unknown): x is string => typeof x === 'string' && x.length > 0;
  const seen = new Set<string>();
  const voicemails: Voicemail[] = [];
  for (const v of m.voicemails) {
    if (!v || !isStr(v.id) || !Array.isArray(v.segments) || !Array.isArray(v.photoIds) || !Array.isArray(v.tags) || typeof v.status !== 'string') throw new Error(DAMAGED);
    if (v.segments.some((s) => !s || !isStr(s.id))) throw new Error(DAMAGED);
    if (!seen.has(v.id)) voicemails.push(v);
    seen.add(v.id);
  }
  for (const c of m.chunks) {
    if (!c || !isStr(c.voicemailId) || !isStr(c.segmentId) || !isStr(c.file) || !Number.isFinite(c.seq) || !Number.isFinite(c.ms) || c.ms < 0 || !Array.isArray(c.peaks)) throw new Error(DAMAGED);
  }
  for (const i of m.images) if (!i || !isStr(i.id) || !isStr(i.file)) throw new Error(DAMAGED);
  const collections: Collection[] = [];
  for (const c of m.collections) {
    if (!c || !isStr(c.id) || !Array.isArray(c.voicemailIds)) throw new Error(DAMAGED);
    collections.push(c);
  }
  return { ...(m as Manifest), voicemails, collections };
}

interface Actions {
  summary: RestoreSummary;
  items: PlanItem[];
  newVoicemails: Voicemail[];
  detailUpdates: Map<string, Partial<Voicemail>>;
  recoverIds: string[];
  chunks: Map<string, Manifest['chunks'][number]>; // by file name
  images: Map<string, Manifest['images'][number]>;
  collectionPuts: Collection[];
  collectionAdds: Map<string, string[]>;
  newCollectionIds: string[];
  settingsPut: { key: string; value: unknown }[];
  unErase: string[];
  settingsDiffer: number;
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Decide exactly what a restore would do. Pure: reads only the manifest and a snapshot of this device. */
function computeActions(m: Manifest, local: LocalState, opt: RestoreOptions): Actions {
  const a: Actions = {
    summary: { added: 0, recovered: 0, recoveredPieces: 0, replaced: 0, retained: 0, collectionsAdded: 0, collectionMembersAdded: 0, settingsToRestore: 0, skipped: { trashedInBackup: 0, trashedHere: 0, erased: 0, notOnThisDevice: 0, noAudio: 0, erasedCollections: 0, otherCollections: 0 } },
    items: [],
    newVoicemails: [],
    detailUpdates: new Map(),
    recoverIds: [],
    chunks: new Map(),
    images: new Map(),
    collectionPuts: [],
    collectionAdds: new Map(),
    newCollectionIds: [],
    settingsPut: [],
    unErase: [],
    settingsDiffer: 0,
  };
  const known = new Set(m.voicemails.map((v) => v.id));
  const chunksByVm = new Map<string, Manifest['chunks']>();
  for (const c of m.chunks) {
    if (!known.has(c.voicemailId)) continue; // audio for a voicemail the backup doesn't describe: ignored
    const list = chunksByVm.get(c.voicemailId) ?? [];
    list.push(c);
    chunksByVm.set(c.voicemailId, list);
  }
  const imageMeta = new Map(m.images.map((i) => [i.id, i]));
  const imageAvailable = (id: string | null | undefined) => !!id && (local.imageIds.has(id) || imageMeta.has(id));
  const wantImage = (id: string) => {
    const meta = imageMeta.get(id);
    if (meta && !local.imageIds.has(id)) a.images.set(meta.file, meta);
  };
  const newIds = new Set<string>();

  for (const bv of m.voicemails) {
    const title = bv.title || bv.prompt || 'untitled';
    const base = { id: bv.id, title, durationMs: bv.durationMs, recoverChunks: 0, newer: false };
    if (bv.status === 'deleted') {
      a.summary.skipped.trashedInBackup++;
      a.items.push({ ...base, kind: 'trashed-backup', included: false });
      continue;
    }
    const here = local.voicemails.get(bv.id);
    if (!here) {
      const erased = local.erased.has(bv.id);
      const chunks = chunksByVm.get(bv.id) ?? [];
      if (!chunks.length) {
        a.summary.skipped.noAudio++;
        a.items.push({ ...base, kind: 'no-audio', included: false });
        continue;
      }
      const included = erased ? opt.includeErased : opt.includeMissing;
      a.items.push({ ...base, kind: erased ? 'erased' : 'new', included, recoverChunks: chunks.length });
      if (!included) {
        if (erased) a.summary.skipped.erased++;
        else a.summary.skipped.notOnThisDevice++;
        continue;
      }
      const have = new Set(chunks.map((c) => c.segmentId));
      const photoIds = bv.photoIds.filter(imageAvailable);
      const coverId = imageAvailable(bv.coverId) ? bv.coverId : null;
      [coverId, ...photoIds].forEach((i) => i && wantImage(i));
      for (const c of chunks) a.chunks.set(c.file, c);
      a.newVoicemails.push({
        ...bv,
        status: bv.status === 'recording' ? 'draft' : bv.status,
        segments: bv.segments.filter((s) => have.has(s.id)),
        photoIds,
        coverId,
        deletedAt: null,
        deletedFrom: null,
        deletedCollections: [],
      });
      newIds.add(bv.id);
      if (erased) a.unErase.push(bv.id);
      a.summary.added++;
      continue;
    }
    if (here.status === 'deleted') {
      // it's in recently deleted here: leave it exactly there
      a.summary.skipped.trashedHere++;
      a.items.push({ ...base, kind: 'trashed-here', included: false });
      continue;
    }
    // already here: keep the current version. Only fill in audio or photos that are missing from it.
    const hereSegments = new Set(here.segments.map((s) => s.id));
    const missing = (chunksByVm.get(bv.id) ?? []).filter((c) => hereSegments.has(c.segmentId) && !local.chunkKeys.has(chunkKey(c.segmentId, c.seq)));
    const imagesBefore = a.images.size;
    [here.coverId, ...here.photoIds].forEach((i) => i && wantImage(i));
    const recoveredImages = a.images.size - imagesBefore;
    for (const c of missing) a.chunks.set(c.file, c);
    const newer = bv.updatedAt > here.updatedAt;
    const recovers = missing.length > 0 || recoveredImages > 0;
    let replaced = false;
    if (newer && opt.useBackupDetails) {
      const patch: Record<string, unknown> = {};
      for (const f of DETAIL_FIELDS) if (!sameJson(bv[f], here[f])) patch[f] = bv[f];
      if (Object.keys(patch).length) {
        a.detailUpdates.set(bv.id, { ...patch, updatedAt: bv.updatedAt } as Partial<Voicemail>);
        replaced = true;
        a.summary.replaced++;
      }
    }
    if (recovers) {
      a.recoverIds.push(bv.id);
      a.summary.recovered++;
      a.summary.recoveredPieces += missing.length;
    }
    if (!recovers && !replaced) a.summary.retained++;
    a.items.push({ ...base, kind: recovers ? 'recover' : 'same', included: recovers || replaced, recoverChunks: missing.length, newer });
  }

  // collections: never removed, never reordered; membership is only added, and only for voicemails restored in this run
  for (const bc of m.collections) {
    const here = local.collections.get(bc.id);
    if (here) {
      const add = bc.voicemailIds.filter((id) => newIds.has(id) && !here.voicemailIds.includes(id));
      if (add.length) {
        a.collectionAdds.set(bc.id, add);
        a.summary.collectionMembersAdded += add.length;
      }
      continue;
    }
    const erased = local.erased.has(bc.id);
    if (erased ? !opt.includeErased : !opt.includeMissing) {
      if (erased) a.summary.skipped.erasedCollections++;
      else a.summary.skipped.otherCollections++;
      continue;
    }
    const members = bc.voicemailIds.filter((id) => newIds.has(id) || (local.voicemails.get(id) && local.voicemails.get(id)!.status !== 'deleted'));
    const coverId = imageAvailable(bc.coverId) ? bc.coverId : null;
    if (coverId) wantImage(coverId);
    a.collectionPuts.push({ ...bc, voicemailIds: members, coverId });
    a.newCollectionIds.push(bc.id);
    if (erased) a.unErase.push(bc.id);
    a.summary.collectionsAdded++;
    a.summary.collectionMembersAdded += members.length;
  }

  // preferences: only the whitelisted ones, only those that actually differ
  const backupSettings = new Map(m.settings.map((r) => [r.key, r.value]));
  for (const key of RESTORABLE_SETTINGS) {
    if (!backupSettings.has(key)) continue;
    let value = backupSettings.get(key);
    const current = local.settings.get(key);
    if (key === 'neverEcho' && Array.isArray(value)) value = [...new Set([...(Array.isArray(current) ? current : []), ...value])];
    if (key === 'onboarded' && !local.fresh) continue;
    if (sameJson(value, current)) continue;
    a.settingsDiffer++;
    if (opt.restoreSettings) a.settingsPut.push({ key, value });
  }
  a.summary.settingsToRestore = opt.restoreSettings ? a.settingsPut.length : 0;
  return a;
}

export function defaultRestoreOptions(freshDevice: boolean): RestoreOptions {
  // a brand-new device has nothing to protect, so everything comes back; otherwise the person opts in to each addition
  return { includeMissing: freshDevice, includeErased: false, useBackupDetails: false, restoreSettings: freshDevice };
}

/** Walk a backup .zip, handing the bytes of wanted files (one at a time) to `handle`. Rejects if the file is cut short. */
async function readZip(
  file: Blob,
  want: (name: string) => boolean,
  handle: (name: string, data: Uint8Array) => Promise<void>,
  onProgress?: (read: number) => void,
): Promise<string[]> {
  const names: string[] = [];
  let writes: Promise<unknown> = Promise.resolve();
  await new Promise<void>((resolve, reject) => {
    const unzip = new Unzip();
    unzip.register(UnzipPassThrough);
    unzip.register(UnzipInflate);
    let open = 0;
    let inputDone = false;
    const maybeDone = () => {
      if (!inputDone) return;
      if (open > 0) return reject(new Error('cut short'));
      writes.then(() => resolve(), reject);
    };
    unzip.onfile = (f) => {
      names.push(f.name);
      const wanted = want(f.name);
      open++;
      const parts: Uint8Array[] = [];
      f.ondata = (err, data, final) => {
        if (err) return reject(err);
        if (wanted) parts.push(data);
        if (!final) return;
        open--;
        if (wanted) {
          const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
          let o = 0;
          for (const p of parts) {
            out.set(p, o);
            o += p.length;
          }
          const name = f.name;
          writes = writes.then(() => handle(name, out));
          writes.catch(reject);
        }
        maybeDone();
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
        await writes; // don't read faster than we can save
        onProgress?.(read);
      }
      unzip.push(new Uint8Array(0), true);
      inputDone = true;
      maybeDone();
    })().catch(reject);
  });
  return names;
}

/** Read and check a backup, and work out what restoring it would do. Changes nothing. */
export async function analyzeBackup(file: Blob, onProgress: (p: BackupProgress) => void = () => {}): Promise<RestorePlan> {
  let manifestBytes: Uint8Array | null = null;
  let names: string[];
  try {
    names = await readZip(
      file,
      (n) => n === 'manifest.json',
      async (_n, data) => {
        manifestBytes = data;
      },
      (read) => onProgress({ done: read, total: file.size, label: 'opening your backup' }),
    );
  } catch {
    throw new Error("this doesn't look like an unspoken backup, or it was cut short. nothing was changed.");
  }
  if (!manifestBytes) throw new Error(NOT_A_BACKUP);
  let parsed: unknown;
  try {
    parsed = JSON.parse(strFromU8(manifestBytes));
  } catch {
    throw new Error(NOT_A_BACKUP);
  }
  const manifest = validateManifest(parsed);
  // every file the backup says it holds must really be inside it, or restoring would bring back part of a voicemail
  const present = new Set(names);
  const missing = [...manifest.chunks.map((c) => c.file), ...manifest.images.map((i) => i.file)].filter((f) => !present.has(f));
  if (missing.length) throw new Error(`this backup is incomplete (${missing.length} ${missing.length === 1 ? 'file is' : 'files are'} missing from it), so nothing was changed. try downloading or copying it again.`);

  const local = await loadLocalState();
  const defaults = defaultRestoreOptions(local.fresh);
  const everything = computeActions(manifest, local, { includeMissing: true, includeErased: true, useBackupDetails: true, restoreSettings: true });
  const shown = computeActions(manifest, local, defaults);
  return {
    exportedAt: manifest.exportedAt,
    freshDevice: local.fresh,
    items: everything.items,
    summary: shown.summary,
    settingsDiffer: everything.settingsDiffer,
    available: {
      missing: everything.items.filter((i) => i.kind === 'new').length,
      erased: everything.items.filter((i) => i.kind === 'erased').length,
      newer: everything.items.filter((i) => i.newer).length,
      settings: everything.settingsDiffer,
    },
    defaults,
    manifest,
  };
}

/** Preview what a given set of options would do, without touching anything. */
export async function previewRestore(plan: RestorePlan, options: RestoreOptions): Promise<RestoreSummary> {
  return computeActions(plan.manifest, await loadLocalState(), options).summary;
}

export interface RestoreResult {
  summary: RestoreSummary;
  /** true when there was nothing to add (a repeat restore, or everything is already here) */
  nothingToDo: boolean;
}

const FAILED = "that backup couldn't be restored. nothing was changed.";
const UNDO_PENDING = "that backup couldn't be restored, and putting things back isn't finished yet. close and reopen unspoken so it can finish.";
const UNRESOLVED = 'a previous restore is still being undone. close and reopen unspoken, then try again.';

/**
 * Apply a restore. Everything added is journaled first; any failure undoes every addition, and nothing that was
 * already here is ever deleted. The journal is cleared in the same transaction that makes the restore visible.
 */
export async function restoreBackup(file: Blob, plan: RestorePlan, options: RestoreOptions, onProgress: (p: BackupProgress) => void): Promise<RestoreResult> {
  // a journal still here means an earlier restore was never undone (its own undo failed, or the app died): starting
  // another would overwrite the only record of what to remove. It is cleared only by a confirmed undo, at next start.
  if (await db.settings.get(RESTORE_JOURNAL_KEY)) throw new Error(UNRESOLVED);

  // recompute against the device as it is *now*, in case anything changed while the preview was open
  const local = await loadLocalState();
  const a = computeActions(plan.manifest, local, options);
  const nothingToDo = !a.newVoicemails.length && !a.chunks.size && !a.images.size && !a.detailUpdates.size && !a.collectionPuts.length && !a.collectionAdds.size && !a.settingsPut.length;
  if (nothingToDo) return { summary: a.summary, nothingToDo: true };

  const journal: RestoreJournal = {
    startedAt: Date.now(),
    newVoicemailIds: a.newVoicemails.map((v) => v.id),
    newCollectionIds: a.newCollectionIds,
    chunkKeys: [...a.chunks.values()].filter((c) => local.voicemails.has(c.voicemailId)).map((c) => [c.voicemailId, c.segmentId, c.seq]),
    imageIds: [...a.images.values()].map((i) => i.id),
  };
  // written before the first change: a crash from here on is undone at next start.
  // If it can't be written nothing has been touched yet, so there is nothing to undo — and without it we must not begin.
  try {
    await db.settings.put({ key: RESTORE_JOURNAL_KEY, value: journal });
  } catch (err) {
    console.error('could not write the restore journal', err);
    throw new Error(FAILED);
  }

  const total = a.chunks.size + a.images.size;
  let done = 0;
  const addedChunks = new Set<string>();
  const addedImages = new Set<string>();
  try {
    await readZip(
      file,
      (n) => a.chunks.has(n) || a.images.has(n),
      async (name, data) => {
        const c = a.chunks.get(name);
        if (c) {
          const k = chunkKey(c.segmentId, c.seq);
          if (addedChunks.has(k)) return;
          // never a second copy of a piece that's already stored
          if ((await db.chunks.where('[segmentId+seq]').equals([c.segmentId, c.seq]).count()) === 0) {
            await db.chunks.add({ voicemailId: c.voicemailId, segmentId: c.segmentId, seq: c.seq, ms: c.ms, peaks: c.peaks, blob: new Blob([data as BlobPart], { type: c.type }) });
          }
          addedChunks.add(k);
          onProgress({ done: ++done, total, label: 'putting your voice back' });
          return;
        }
        const i = a.images.get(name);
        if (i && !addedImages.has(i.id)) {
          if (!(await db.images.get(i.id))) await db.images.put({ id: i.id, createdAt: i.createdAt, blob: new Blob([data as BlobPart], { type: i.type }) });
          addedImages.add(i.id);
          onProgress({ done: ++done, total, label: 'putting your photos back' });
        }
      },
    );
    // everything the plan needs must have arrived, or we'd be presenting part of a voicemail as the whole
    if (addedChunks.size < new Set([...a.chunks.values()].map((c) => chunkKey(c.segmentId, c.seq))).size || addedImages.size < a.images.size) throw new Error('incomplete backup');

    await db.transaction('rw', [db.voicemails, db.chunks, db.collections, db.settings, db.images], async () => {
      if (a.newVoicemails.length) await db.voicemails.bulkAdd(a.newVoicemails);
      for (const [id, patch] of a.detailUpdates) await db.voicemails.update(id, patch);
      for (const id of [...a.newVoicemails.map((v) => v.id), ...a.recoverIds]) {
        await rebuildFromChunks(id);
      }
      if (a.collectionPuts.length) await db.collections.bulkAdd(a.collectionPuts);
      for (const [id, add] of a.collectionAdds) {
        const c = await db.collections.get(id);
        if (c) await db.collections.update(id, { voicemailIds: [...c.voicemailIds, ...add.filter((v) => !c.voicemailIds.includes(v))], updatedAt: Date.now() });
      }
      if (a.settingsPut.length) await db.settings.bulkPut(a.settingsPut);
      if (a.unErase.length) await forgetErased(a.unErase);
      await db.settings.delete(RESTORE_JOURNAL_KEY);
    });
  } catch (err) {
    console.error('restore failed', err);
    // put everything back as it was; if even that can't finish now, the journal makes the next start do it,
    // and the person is told so instead of being told "nothing was changed"
    let undone = true;
    await undoRestoreFromJournal(journal).catch((e) => {
      undone = false;
      console.error('restore undo is pending until next start', e);
    });
    throw new Error(undone ? FAILED : UNDO_PENDING);
  }
  return { summary: a.summary, nothingToDo: false };
}
