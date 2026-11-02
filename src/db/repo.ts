import { db, uid } from './db';
import { DEFAULT_SETTINGS, type Collection, type Settings, type Voicemail } from './types';

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
    if (rebuilt && rebuilt.durationMs > 0) {
      await updateVoicemail(vm.id, { status: 'draft' });
      recovered++;
    } else {
      await deleteVoicemail(vm.id);
    }
  }
  return recovered;
}

export async function deleteVoicemail(id: string) {
  const vm = await db.voicemails.get(id);
  await db.transaction('rw', [db.voicemails, db.chunks, db.images, db.collections], async () => {
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

export function isLocked(vm: Pick<Voicemail, 'unlockAt'>, now = Date.now()): boolean {
  return vm.unlockAt != null && vm.unlockAt > now;
}

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
  await db.collections.delete(id);
}

// ---------------------------------------------------------------- everything

export async function wipeEverything() {
  await db.transaction('rw', [db.voicemails, db.chunks, db.images, db.collections, db.settings], async () => {
    await Promise.all([db.voicemails.clear(), db.chunks.clear(), db.images.clear(), db.collections.clear(), db.settings.clear()]);
  });
}
