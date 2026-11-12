import { db, uid } from './db';
import { DEFAULT_SETTINGS, DELETED_KEEP_DAYS, type Collection, type Settings, type Voicemail } from './types';

// ---------------------------------------------------------------- settings

export async function getSettings(): Promise<Settings> {
  const rows = await db.settings.toArray();
  const s: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) s[r.key] = r.value;
  return s as unknown as Settings;
}

export async function setSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
  await db.settings.put({ key, value });
}

// ---------------------------------------------------------------- voicemails

export function newVoicemail(partial: Partial<Voicemail> = {}): Voicemail {
  const now = Date.now();
  return {
    id: uid(),
    status: 'recording',
    createdAt: now,
    recordedAt: now,
    updatedAt: now,
    title: '',
    description: '',
    mood: null,
    tags: [],
    coverId: null,
    photoIds: [],
    durationMs: 0,
    segments: [],
    peaks: [],
    transcript: '',
    transcriptVisible: true,
    prompt: null,
    unlockAt: null,
    unlockSeen: false,
    lastPlayedAt: null,
    playCount: 0,
    stoppedEarly: null,
    ...partial,
  };
}

export async function updateVoicemail(id: string, changes: Partial<Voicemail>) {
  await db.voicemails.update(id, { ...changes, updatedAt: Date.now() });
}

/** Read the persisted chunks of one segment and join them into a playable blob. */
export async function segmentBlob(segmentId: string, mimeType: string): Promise<Blob> {
  const chunks = await db.chunks.where('[segmentId+seq]').between([segmentId, -Infinity], [segmentId, Infinity]).toArray();
  return new Blob(
    chunks.map((c) => c.blob),
    { type: mimeType },
  );
}

/** True when every part of a voicemail still has saved audio — the test for offering a download after playback fails. */
export async function hasSavedAudio(vm: Pick<Voicemail, 'segments'>): Promise<boolean> {
  if (!vm.segments.length) return false;
  for (const seg of vm.segments) {
    if ((await db.chunks.where('segmentId').equals(seg.id).count()) === 0) return false;
  }
  return true;
}

/**
 * Recompute a voicemail's duration, segments and peaks from its chunks.
 * Used when finishing, and when recovering a recording interrupted by a crash or closed tab.
 */
export async function rebuildFromChunks(id: string): Promise<Voicemail | undefined> {
  const vm = await db.voicemails.get(id);
  if (!vm) return undefined;
  const chunks = await db.chunks.where('voicemailId').equals(id).toArray();
  const bySegment = new Map<string, { ms: number; peaks: number[]; seqs: { seq: number; peaks: number[] }[] }>();
  for (const c of chunks) {
    const entry = bySegment.get(c.segmentId) ?? { ms: 0, peaks: [], seqs: [] };
    entry.ms += c.ms;
    entry.seqs.push({ seq: c.seq, peaks: c.peaks });
    bySegment.set(c.segmentId, entry);
  }
  const segments = vm.segments.filter((s) => bySegment.has(s.id)).map((s) => ({ ...s, durationMs: bySegment.get(s.id)!.ms }));
  const peaks: number[] = [];
  for (const s of segments) {
    const e = bySegment.get(s.id)!;
    e.seqs.sort((a, b) => a.seq - b.seq);
    for (const q of e.seqs) peaks.push(...q.peaks);
  }
  const durationMs = segments.reduce((a, s) => a + s.durationMs, 0);
  const changes = { segments, peaks, durationMs };
  await updateVoicemail(id, changes);
  return { ...vm, ...changes };
}

/** On app start: anything still marked "recording" was interrupted. Keep it as a draft — never lose it. */
export async function recoverInterruptedRecordings(): Promise<number> {
  const stuck = await db.voicemails.where('status').equals('recording').toArray();
  let recovered = 0;
  for (const vm of stuck) {
    const rebuilt = await rebuildFromChunks(vm.id);
    // keep anything over a second; shorter than that was an accidental tap
    if (rebuilt && rebuilt.durationMs >= 1000) {
      await updateVoicemail(vm.id, { status: 'draft' });
      recovered++;
    } else {
      // an accidental tap, not something the person erased on purpose: nothing to remember
      await deleteVoicemail(vm.id, { remember: false });
    }
  }
  return recovered;
}

/**
 * "Delete" from the app: the voicemail moves to recently deleted for DELETED_KEEP_DAYS days.
 * Nothing is erased yet, and restoring puts it back exactly where it was — including its collections.
 */
export async function moveToDeleted(id: string) {
  await db.transaction('rw', [db.voicemails, db.collections], async () => {
    const vm = await db.voicemails.get(id);
    if (!vm || vm.status === 'deleted') return;
    const cols = await db.collections.where('voicemailIds').equals(id).toArray();
    for (const c of cols) await db.collections.update(c.id, { voicemailIds: c.voicemailIds.filter((v) => v !== id) });
    await db.voicemails.update(id, {
      status: 'deleted',
      deletedAt: Date.now(),
      deletedFrom: vm.status === 'draft' ? 'draft' : 'saved',
      deletedCollections: cols.map((c) => c.id),
    });
  });
}

export async function restoreDeleted(id: string) {
  await db.transaction('rw', [db.voicemails, db.collections], async () => {
    const vm = await db.voicemails.get(id);
    if (!vm || vm.status !== 'deleted') return;
    for (const cid of vm.deletedCollections ?? []) {
      const c = await db.collections.get(cid);
      if (c && !c.voicemailIds.includes(id)) await db.collections.update(cid, { voicemailIds: [...c.voicemailIds, id] });
    }
    await db.voicemails.update(id, { status: vm.deletedFrom ?? 'saved', deletedAt: null, deletedFrom: null, deletedCollections: [] });
  });
}

/** Erase voicemails that have been in recently deleted for longer than DELETED_KEEP_DAYS. Runs on start-up. */
export async function purgeOldDeleted(now = Date.now()): Promise<number> {
  const cutoff = now - DELETED_KEEP_DAYS * 86_400_000;
  const old = await db.voicemails.where('status').equals('deleted').filter((v) => (v.deletedAt ?? 0) < cutoff).toArray();
  for (const v of old) await deleteVoicemail(v.id);
  return old.length;
}

/** Erase a voicemail for good: its audio, artwork and photos. Used by "delete forever" and the 30-day clean-up. */
export async function deleteVoicemail(id: string, opts: { remember?: boolean } = {}) {
  const vm = await db.voicemails.get(id);
  await db.transaction('rw', [db.voicemails, db.chunks, db.images, db.collections, db.settings], async () => {
    // remember that this was erased on purpose, so restoring an older backup never quietly brings it back
    if (opts.remember !== false) await rememberErased([id]);
    await db.chunks.where('voicemailId').equals(id).delete();
    if (vm) {
      const imageIds = [vm.coverId, ...vm.photoIds].filter(Boolean) as string[];
      await db.images.bulkDelete(imageIds);
    }
    const cols = await db.collections.where('voicemailIds').equals(id).toArray();
    for (const c of cols) {
      await db.collections.update(c.id, { voicemailIds: c.voicemailIds.filter((v) => v !== id) });
    }
    await db.voicemails.delete(id);
  });
}

export { isLocked } from '../lib/library';

export async function markPlayed(id: string) {
  const vm = await db.voicemails.get(id);
  if (!vm) return;
  await db.voicemails.update(id, { lastPlayedAt: Date.now(), playCount: vm.playCount + 1 });
}

// ---------------------------------------------------------------- images

export async function saveImage(blob: Blob): Promise<string> {
  const id = uid();
  await db.images.put({ id, blob, createdAt: Date.now() });
  return id;
}

export async function deleteImage(id: string | null | undefined) {
  if (id) await db.images.delete(id);
}

// ---------------------------------------------------------------- collections

export async function createCollection(title: string, description = ''): Promise<string> {
  const now = Date.now();
  const c: Collection = {
    id: uid(),
    title: title.trim() || 'untitled collection',
    description,
    coverId: null,
    voicemailIds: [],
    createdAt: now,
    updatedAt: now,
  };
  await db.collections.put(c);
  return c.id;
}

export async function addToCollection(collectionId: string, voicemailId: string) {
  const c = await db.collections.get(collectionId);
  if (!c || c.voicemailIds.includes(voicemailId)) return;
  await db.collections.update(collectionId, { voicemailIds: [...c.voicemailIds, voicemailId], updatedAt: Date.now() });
}

export async function removeFromCollection(collectionId: string, voicemailId: string) {
  const c = await db.collections.get(collectionId);
  if (!c) return;
  await db.collections.update(collectionId, {
    voicemailIds: c.voicemailIds.filter((v) => v !== voicemailId),
    updatedAt: Date.now(),
  });
}

export async function moveInCollection(collectionId: string, index: number, delta: number) {
  const c = await db.collections.get(collectionId);
  if (!c) return;
  const ids = [...c.voicemailIds];
  const target = index + delta;
  if (target < 0 || target >= ids.length) return;
  [ids[index], ids[target]] = [ids[target], ids[index]];
  await db.collections.update(collectionId, { voicemailIds: ids, updatedAt: Date.now() });
}

/** Deleting a collection never deletes the voicemails inside it. */
export async function deleteCollection(id: string) {
  const c = await db.collections.get(id);
  await deleteImage(c?.coverId);
  await db.transaction('rw', [db.collections, db.settings], async () => {
    await rememberErased([id]);
    await db.collections.delete(id);
  });
}

// ---------------------------------------------------------------- erased ids (so a restore can't resurrect them)

const ERASED_KEY = 'erasedIds';
/** Enough for years of use, and small: each entry is just an id. Oldest are forgotten first. */
const ERASED_LIMIT = 5000;

export async function getErasedIds(): Promise<Set<string>> {
  const row = await db.settings.get(ERASED_KEY);
  return new Set(Array.isArray(row?.value) ? (row!.value as string[]) : []);
}

/** Call inside a transaction that includes db.settings. */
export async function rememberErased(ids: string[]) {
  const row = await db.settings.get(ERASED_KEY);
  const current = Array.isArray(row?.value) ? (row!.value as string[]) : [];
  const next = [...current.filter((x) => !ids.includes(x)), ...ids].slice(-ERASED_LIMIT);
  await db.settings.put({ key: ERASED_KEY, value: next });
}

export async function forgetErased(ids: string[]) {
  const row = await db.settings.get(ERASED_KEY);
  if (!Array.isArray(row?.value)) return;
  await db.settings.put({ key: ERASED_KEY, value: (row!.value as string[]).filter((x) => !ids.includes(x)) });
}

// ---------------------------------------------------------------- crash-safe restore

export const RESTORE_JOURNAL_KEY = 'restoreJournal';

/** What a restore in progress has added, written *before* the first change so a crash can be undone. */
export interface RestoreJournal {
  startedAt: number;
  newVoicemailIds: string[];
  newCollectionIds: string[];
  /** audio pieces added to voicemails that were already here */
  chunkKeys: [string, string, number][];
  imageIds: string[];
}

/** Remove everything a restore added, using its journal. Safe to run any number of times. */
export async function undoRestoreFromJournal(j: RestoreJournal) {
  const committed = new Set((await db.voicemails.bulkGet(j.newVoicemailIds)).filter(Boolean).map((v) => v!.id));
  await db.transaction('rw', [db.chunks, db.images, db.voicemails, db.collections, db.settings], async () => {
    for (const id of j.newVoicemailIds) if (!committed.has(id)) await db.chunks.where('voicemailId').equals(id).delete();
    for (const [voicemailId, segmentId, seq] of j.chunkKeys) {
      await db.chunks.where('[segmentId+seq]').equals([segmentId, seq]).filter((c) => c.voicemailId === voicemailId).delete();
    }
    const referenced = new Set<string>();
    if (j.imageIds.length) {
      for (const v of await db.voicemails.toArray()) [v.coverId, ...v.photoIds].forEach((x) => x && referenced.add(x));
      for (const c of await db.collections.toArray()) if (c.coverId) referenced.add(c.coverId);
    }
    await db.images.bulkDelete(j.imageIds.filter((i) => !referenced.has(i)));
    await db.settings.delete(RESTORE_JOURNAL_KEY);
  });
}

/** On app start: if a restore was cut off (crash, closed tab), put everything back as it was before it began. */
export async function undoInterruptedRestore(): Promise<boolean> {
  const row = await db.settings.get(RESTORE_JOURNAL_KEY);
  if (!row?.value) return false;
  await undoRestoreFromJournal(row.value as RestoreJournal);
  return true;
}

// ---------------------------------------------------------------- everything

export async function wipeEverything() {
  await db.transaction('rw', [db.voicemails, db.chunks, db.images, db.collections, db.settings], async () => {
    await Promise.all([db.voicemails.clear(), db.chunks.clear(), db.images.clear(), db.collections.clear(), db.settings.clear()]);
  });
}
