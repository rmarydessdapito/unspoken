import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { db } from '../src/db/db';
import {
  addToCollection,
  createCollection,
  deleteCollection,
  deleteVoicemail,
  moveToDeleted,
  newVoicemail,
  recoverInterruptedRecordings,
  RESTORE_JOURNAL_KEY,
  saveImage,
  segmentBlob,
  undoInterruptedRestore,
} from '../src/db/repo';
import { analyzeBackup, memorySink, restoreBackup, writeBackup, type RestoreOptions } from '../src/lib/backup';

/** Everything in the database, including the bytes of every audio piece and photo, so 'unchanged' means unchanged. */
async function deepSnapshot() {
  const chunks = await Promise.all((await db.chunks.toArray()).map(async (c) => [c.voicemailId, c.segmentId, c.seq, c.ms, c.peaks, await c.blob.text()] as const));
  const images = await Promise.all((await db.images.toArray()).map(async (i) => [i.id, i.createdAt, await i.blob.text()] as const));
  const sort = <T,>(a: T[]) => a.map((x) => JSON.stringify(x)).sort();
  return {
    voicemails: sort(await db.voicemails.toArray()),
    collections: sort(await db.collections.toArray()),
    settings: sort(await db.settings.toArray()),
    chunks: sort(chunks),
    images: sort(images),
  };
}

async function seed(id: string, segs: { id: string; chunks: number }[], extra: Partial<ReturnType<typeof newVoicemail>> = {}) {
  await db.voicemails.add(newVoicemail({ id, status: 'saved', segments: segs.map((s) => ({ id: s.id, mimeType: 'audio/webm', durationMs: s.chunks * 2000 })), durationMs: segs.reduce((a, s) => a + s.chunks * 2000, 0), ...extra }));
  for (const s of segs) for (let i = 0; i < s.chunks; i++) await db.chunks.add({ voicemailId: id, segmentId: s.id, seq: i, blob: new Blob([`${s.id}-${i};`]), ms: 2000, peaks: [0.1] });
}
const clearAll = () => Promise.all([db.voicemails.clear(), db.chunks.clear(), db.images.clear(), db.collections.clear(), db.settings.clear()]);
const backup = async () => (await writeBackup(memorySink()))!;
async function restore(zip: Blob, opts: Partial<RestoreOptions> = {}) {
  const plan = await analyzeBackup(zip);
  const result = await restoreBackup(zip, plan, { ...plan.defaults, ...opts }, () => {});
  return { plan, result };
}
const text = async (seg: string) => (await segmentBlob(seg, 'audio/webm')).text();
const snapshot = async () => ({ v: await db.voicemails.toArray(), c: (await db.chunks.toArray()).map((x) => [x.segmentId, x.seq]), i: await db.images.count(), col: await db.collections.toArray(), s: await db.settings.toArray() });

beforeEach(async () => {
  vi.restoreAllMocks();
  await clearAll();
});

describe('restoring onto a new device', () => {
  it('brings back audio, photos, collections and preferences — but never lock secrets', async () => {
    await seed('v1', [{ id: 's1', chunks: 3 }], { title: 'things i never said' });
    const img = await saveImage(new Blob(['cover-bytes'], { type: 'image/jpeg' }));
    await db.voicemails.update('v1', { coverId: img });
    const col = await createCollection('people i love');
    await addToCollection(col, 'v1');
    await db.settings.bulkPut([
      { key: 'name', value: 'rmarydess' },
      { key: 'passcodeHash', value: 'secret' },
    ]);
    const zip = await backup();
    await clearAll();

    const { plan, result } = await restore(zip);
    expect(plan.freshDevice).toBe(true);
    expect(result.summary.added).toBe(1);
    expect((await db.voicemails.get('v1'))?.title).toBe('things i never said');
    expect(await text('s1')).toBe('s1-0;s1-1;s1-2;');
    expect(await (await db.images.get(img))!.blob.text()).toBe('cover-bytes');
    expect((await db.collections.get(col))?.voicemailIds).toEqual(['v1']);
    expect((await db.settings.get('name'))?.value).toBe('rmarydess');
    expect(await db.settings.get('passcodeHash')).toBeUndefined();
    expect(await db.settings.get(RESTORE_JOURNAL_KEY)).toBeUndefined();
    expect((await db.voicemails.get('v1'))?.durationMs).toBe(6000);
  });

  it('is safe to repeat: no duplicate audio or photos, and the second run reports nothing to do', async () => {
    await seed('v1', [{ id: 's1', chunks: 3 }]);
    const img = await saveImage(new Blob(['p']));
    await db.voicemails.update('v1', { photoIds: [img] });
    const zip = await backup();
    await clearAll();
    await restore(zip);
    const before = await snapshot();
    const again = await restore(zip);
    expect(again.result.nothingToDo).toBe(true);
    expect(await db.chunks.count()).toBe(3);
    expect(await db.images.count()).toBe(1);
    expect(await snapshot()).toEqual(before);
  });
});

describe('restoring next to existing data', () => {
  it('keeps everything that is here: later voicemails, photos, and audio recorded after the backup', async () => {
    await seed('in-backup', [{ id: 's1', chunks: 2 }]);
    const zip = await backup();
    await seed('made-later', [{ id: 's2', chunks: 3 }]);
    await db.chunks.add({ voicemailId: 'in-backup', segmentId: 's1', seq: 2, blob: new Blob(['s1-2;']), ms: 2000, peaks: [] }); // continued after the backup
    const photo = await saveImage(new Blob(['later-photo']));
    await restore(zip);
    expect(await text('s2')).toBe('s2-0;s2-1;s2-2;');
    expect(await text('s1')).toBe('s1-0;s1-1;s1-2;');
    expect(await (await db.images.get(photo))!.blob.text()).toBe('later-photo');
    expect(await db.chunks.count()).toBe(6);
  });

  it('never overwrites a newer voicemail: an older backup changes nothing, even with every option on', async () => {
    await seed('v1', [{ id: 's1', chunks: 2 }], { title: 'old title', updatedAt: 1000 });
    const zip = await backup();
    await db.voicemails.update('v1', { title: 'my newer title', description: 'written later', updatedAt: 5000 });
    const before = await snapshot();
    const { plan } = await restore(zip, { includeMissing: true, includeErased: true, useBackupDetails: true, restoreSettings: true });
    expect(plan.available.newer).toBe(0);
    expect(await snapshot()).toEqual(before);
  });

  it('uses a newer backup’s details only when asked, and never touches the audio or photos', async () => {
    await seed('v1', [{ id: 's1', chunks: 2 }], { title: 'before', updatedAt: 1000 });
    const zip0 = await backup();
    // pretend the backup was edited more recently than this device's copy
    const bytes = await db.voicemails.get('v1');
    await db.voicemails.update('v1', { title: 'edited in the backup', tags: ['kept'], updatedAt: 9000 });
    const zip = await backup();
    await db.voicemails.update('v1', { title: 'before', tags: [], updatedAt: 1000 });
    await db.chunks.add({ voicemailId: 'v1', segmentId: 's1', seq: 2, blob: new Blob(['extra;']), ms: 2000, peaks: [] });

    await restore(zip);
    expect((await db.voicemails.get('v1'))?.title).toBe('before'); // default: keep what's here

    await restore(zip, { useBackupDetails: true });
    const vm = await db.voicemails.get('v1');
    expect(vm?.title).toBe('edited in the backup');
    expect(vm?.tags).toEqual(['kept']);
    expect(await text('s1')).toBe('s1-0;s1-1;extra;'); // the audio here is exactly as it was
    expect(bytes && zip0).toBeTruthy();
  });

  it('does not bring a recently deleted voicemail back, and leaves its audio alone', async () => {
    await seed('v1', [{ id: 's1', chunks: 2 }]);
    const zip = await backup();
    await moveToDeleted('v1');
    const { result } = await restore(zip, { includeMissing: true });
    expect(result.summary.skipped.trashedHere).toBe(1);
    expect((await db.voicemails.get('v1'))?.status).toBe('deleted');
    expect(await db.chunks.count()).toBe(2);
  });

  it('skips voicemails that were in recently deleted when the backup was made', async () => {
    await seed('gone', [{ id: 'sg', chunks: 2 }]);
    await moveToDeleted('gone');
    await seed('kept', [{ id: 'sk', chunks: 1 }]);
    const zip = await backup();
    await clearAll();
    const { result } = await restore(zip);
    expect(result.summary.skipped.trashedInBackup).toBe(1);
    expect(await db.voicemails.get('gone')).toBeUndefined();
    expect(await db.chunks.where('segmentId').equals('sg').count()).toBe(0);
    expect(await db.voicemails.get('kept')).toBeTruthy();
  });

  it('recovers audio that is missing from a voicemail, without resurrecting a session that was discarded', async () => {
    await seed('v1', [{ id: 's1', chunks: 3 }, { id: 'discarded', chunks: 2 }]);
    const zip = await backup();
    await db.chunks.where('segmentId').equals('s1').filter((c) => c.seq === 1).delete(); // lost
    await db.chunks.where('segmentId').equals('discarded').delete(); // deliberately removed with its segment
    await db.voicemails.update('v1', { segments: [{ id: 's1', mimeType: 'audio/webm', durationMs: 4000 }] });
    const { result } = await restore(zip);
    expect(result.summary.recovered).toBe(1);
    expect(await text('s1')).toBe('s1-0;s1-1;s1-2;');
    expect(await db.chunks.where('segmentId').equals('discarded').count()).toBe(0);
    expect((await db.voicemails.get('v1'))?.durationMs).toBe(6000);
  });
});

describe('what counts as erased', () => {
  it('does not resurrect a voicemail that was erased for good, unless the person opts in', async () => {
    await seed('v1', [{ id: 's1', chunks: 2 }]);
    await seed('keep', [{ id: 'sk', chunks: 1 }]);
    const zip = await backup();
    await deleteVoicemail('v1');
    const first = await restore(zip, { includeMissing: true });
    expect(first.result.summary.skipped.erased).toBe(1);
    expect(await db.voicemails.get('v1')).toBeUndefined();

    const second = await restore(zip, { includeErased: true, includeMissing: true });
    expect(second.result.summary.added).toBe(1);
    expect(await text('s1')).toBe('s1-0;s1-1;');
    // and once brought back on purpose it is no longer treated as erased
    const third = await restore(zip, { includeMissing: true });
    expect(third.result.nothingToDo).toBe(true);
  });

  it('does not treat an accidental blip cleaned up at start-up as an erasure', async () => {
    await db.voicemails.add(newVoicemail({ id: 'blip', status: 'recording', segments: [{ id: 'sb', mimeType: 'audio/webm', durationMs: 0 }] }));
    await recoverInterruptedRecordings();
    expect((await db.settings.get('erasedIds'))?.value ?? []).not.toContain('blip');
  });

  it('does not recreate a collection that was deleted on purpose', async () => {
    await seed('v1', [{ id: 's1', chunks: 1 }]);
    const col = await createCollection('gone for good');
    await addToCollection(col, 'v1');
    const zip = await backup();
    await deleteCollection(col);
    const { result } = await restore(zip, { includeMissing: true });
    expect(result.summary.skipped.erasedCollections).toBe(1);
    expect(await db.collections.get(col)).toBeUndefined();
  });

  it('on a device that already has data, voicemails it has never seen are an opt-in', async () => {
    await seed('theirs', [{ id: 'st', chunks: 1 }]);
    const zip = await backup();
    await clearAll();
    await seed('mine', [{ id: 'sm', chunks: 1 }]);
    const { plan, result } = await restore(zip);
    expect(plan.freshDevice).toBe(false);
    expect(plan.available.missing).toBe(1);
    expect(result.nothingToDo).toBe(true);
    expect(await db.voicemails.get('theirs')).toBeUndefined();
    await restore(zip, { includeMissing: true });
    expect(await db.voicemails.get('theirs')).toBeTruthy();
    expect(await db.voicemails.get('mine')).toBeTruthy();
  });
});

describe('collections and settings', () => {
  it('merges collection membership without ever removing any', async () => {
    await seed('a', [{ id: 'sa', chunks: 1 }]);
    await seed('b', [{ id: 'sb', chunks: 1 }]);
    const col = await createCollection('favourites');
    await addToCollection(col, 'a');
    await addToCollection(col, 'b');
    const zip = await backup();
    await clearAll();
    // this device has its own version of the collection and its own voicemail
    await seed('mine', [{ id: 'sm', chunks: 1 }]);
    await db.collections.add({ id: col, title: 'renamed here', description: '', coverId: null, voicemailIds: ['mine'], createdAt: 1, updatedAt: 1 });
    await restore(zip, { includeMissing: true });
    const c = await db.collections.get(col);
    expect(c?.title).toBe('renamed here');
    expect(c?.voicemailIds).toEqual(['mine', 'a', 'b']);
    // a second restore changes nothing
    await restore(zip, { includeMissing: true });
    expect((await db.collections.get(col))?.voicemailIds).toEqual(['mine', 'a', 'b']);
  });

  it('keeps this device’s preferences unless asked, and never restores security settings', async () => {
    await db.settings.bulkPut([
      { key: 'name', value: 'from the backup' },
      { key: 'haptics', value: false },
    ]);
    await seed('x', [{ id: 'sx', chunks: 1 }]);
    const zip = await backup();
    // a hand-made manifest that tries to sneak in lock settings
    const bytes = await db.settings.toArray();
    expect(bytes.length).toBeGreaterThan(0);
    await clearAll();
    await seed('mine', [{ id: 'sm', chunks: 1 }]);
    await db.settings.bulkPut([
      { key: 'name', value: 'local name' },
      { key: 'passcodeHash', value: 'local-secret' },
    ]);
    const plan = await analyzeBackup(zip);
    expect(plan.defaults.restoreSettings).toBe(false);
    await restoreBackup(zip, plan, { ...plan.defaults, includeMissing: true }, () => {});
    expect((await db.settings.get('name'))?.value).toBe('local name');

    await restoreBackup(zip, plan, { ...plan.defaults, restoreSettings: true }, () => {});
    expect((await db.settings.get('name'))?.value).toBe('from the backup');
    expect((await db.settings.get('passcodeHash'))?.value).toBe('local-secret');
  });

  it('ignores lock settings even if a backup contains them', async () => {
    const vm = newVoicemail({ id: 'm', status: 'saved', segments: [{ id: 'sm', mimeType: 'audio/webm', durationMs: 2000 }] });
    const manifest = {
      format: 'unspoken-backup', version: 1, exportedAt: 1, voicemails: [vm], collections: [],
      settings: [{ key: 'passcodeHash', value: 'evil' }, { key: 'failedUnlocks', value: 3 }, { key: 'name', value: 'ok' }],
      chunks: [{ voicemailId: 'm', segmentId: 'sm', seq: 0, ms: 2000, peaks: [], file: 'audio/m/sm-000000.bin', type: 'audio/webm' }], images: [],
    };
    const zip = new Blob([zipSync({ 'manifest.json': strToU8(JSON.stringify(manifest)), 'audio/m/sm-000000.bin': strToU8('a') }) as BlobPart]);
    await restore(zip);
    expect(await db.settings.get('passcodeHash')).toBeUndefined();
    expect(await db.settings.get('failedUnlocks')).toBeUndefined();
    expect((await db.settings.get('name'))?.value).toBe('ok');
  });
});

describe('validation and rollback', () => {
  it('analysing a backup changes nothing', async () => {
    await seed('v1', [{ id: 's1', chunks: 2 }]);
    const zip = await backup();
    await clearAll();
    await seed('mine', [{ id: 'sm', chunks: 1 }]);
    const before = await snapshot();
    await analyzeBackup(zip);
    expect(await snapshot()).toEqual(before);
  });

  it('rejects files that are not unspoken backups', async () => {
    const bogus = new Blob([zipSync({ 'hello.txt': strToU8('hi') }) as BlobPart]);
    await expect(analyzeBackup(bogus)).rejects.toThrow(/unspoken backup/);
    await expect(analyzeBackup(new Blob(['not a zip at all']))).rejects.toThrow(/unspoken backup/);
  });

  it('rejects a backup from a different version, or with a damaged manifest, before touching anything', async () => {
    const mk = (m: unknown) => new Blob([zipSync({ 'manifest.json': strToU8(JSON.stringify(m)) }) as BlobPart]);
    const base = { format: 'unspoken-backup', exportedAt: 1, voicemails: [], collections: [], settings: [], chunks: [], images: [] };
    await expect(analyzeBackup(mk({ ...base, version: 2 }))).rejects.toThrow(/different version/);
    await expect(analyzeBackup(mk({ ...base, version: 1, voicemails: [{ id: 5 }] }))).rejects.toThrow(/damaged/);
    await expect(analyzeBackup(mk({ ...base, version: 1, chunks: [{ voicemailId: 'a' }] }))).rejects.toThrow(/damaged/);
  });

  it('still restores backups made by the first version (manifest at the end)', async () => {
    const vm = newVoicemail({ id: 'legacy', status: 'saved', title: 'an old backup', segments: [{ id: 'sl', mimeType: 'audio/webm', durationMs: 2000 }] });
    const manifest = {
      format: 'unspoken-backup', version: 1, exportedAt: Date.now(), voicemails: [vm], collections: [], settings: [],
      chunks: [{ voicemailId: 'legacy', segmentId: 'sl', seq: 0, ms: 2000, peaks: [0.5], file: 'audio/legacy/sl-000000.bin', type: 'audio/webm' }], images: [],
    };
    const zip = zipSync({ 'audio/legacy/sl-000000.bin': strToU8('legacy-audio'), 'manifest.json': strToU8(JSON.stringify(manifest)) });
    await restore(new Blob([zip as BlobPart]));
    expect((await db.voicemails.get('legacy'))?.title).toBe('an old backup');
    expect(await text('sl')).toBe('legacy-audio');
  });

  it('refuses a backup whose audio is missing and changes nothing', async () => {
    await seed('v1', [{ id: 's1', chunks: 2 }]);
    const vm = await db.voicemails.get('v1');
    const manifest = {
      format: 'unspoken-backup', version: 1, exportedAt: Date.now(), voicemails: [vm], collections: [], settings: [],
      chunks: [0, 1].map((seq) => ({ voicemailId: 'v1', segmentId: 's1', seq, ms: 2000, peaks: [], file: `audio/v1/s1-00000${seq}.bin`, type: 'audio/webm' })), images: [],
    };
    const zip = new Blob([zipSync({ 'manifest.json': strToU8(JSON.stringify(manifest)), 'audio/v1/s1-000000.bin': strToU8('only-one') }) as BlobPart]);
    const before = await snapshot();
    await expect(analyzeBackup(zip)).rejects.toThrow(/incomplete/);
    expect(await snapshot()).toEqual(before);
  });

  it('leaves everything as it was when a backup is cut short', async () => {
    await seed('v1', [{ id: 's1', chunks: 3 }]);
    const zip = await backup();
    const bytes = new Uint8Array(await zip.arrayBuffer());
    const before = await snapshot();
    await expect(analyzeBackup(new Blob([bytes.slice(0, Math.floor(bytes.length * 0.6))]))).rejects.toThrow();
    expect(await snapshot()).toEqual(before);
  });

  it('undoes every addition when the last step fails, and keeps what was already here', async () => {
    await seed('theirs', [{ id: 'st', chunks: 3 }]);
    await db.images.put({ id: 'ph', blob: new Blob(['p']), createdAt: 1 });
    await db.voicemails.update('theirs', { photoIds: ['ph'] });
    const zip = await backup();
    await clearAll();
    await seed('mine', [{ id: 'sm', chunks: 2 }]);
    const before = await snapshot();
    vi.spyOn(db.voicemails, 'bulkAdd').mockRejectedValue(new Error('disk full'));
    const plan = await analyzeBackup(zip);
    await expect(restoreBackup(zip, plan, { ...plan.defaults, includeMissing: true }, () => {})).rejects.toThrow('nothing was changed');
    vi.restoreAllMocks();
    expect(await snapshot()).toEqual(before);
    expect(await db.settings.get(RESTORE_JOURNAL_KEY)).toBeUndefined();
  });

  it('undoes additions when saving audio fails part-way through', async () => {
    await seed('theirs', [{ id: 'st', chunks: 4 }]);
    const zip = await backup();
    await clearAll();
    await seed('mine', [{ id: 'sm', chunks: 2 }]);
    const before = await snapshot();
    const real = db.chunks.add.bind(db.chunks);
    let n = 0;
    vi.spyOn(db.chunks, 'add').mockImplementation(((row: never) => (++n === 3 ? Promise.reject(new Error('quota')) : real(row))) as never);
    const plan = await analyzeBackup(zip);
    await expect(restoreBackup(zip, plan, { ...plan.defaults, includeMissing: true }, () => {})).rejects.toThrow('nothing was changed');
    vi.restoreAllMocks();
    expect(await snapshot()).toEqual(before);
  });

  it('a restore that is cut off by a crash is undone at the next start', async () => {
    await seed('mine', [{ id: 'sm', chunks: 2 }]);
    const before = await snapshot();
    // what a half-finished restore leaves behind: its journal, plus audio and a photo that no voicemail owns yet
    await db.settings.put({
      key: RESTORE_JOURNAL_KEY,
      value: { startedAt: 1, newVoicemailIds: ['ghost'], newCollectionIds: [], chunkKeys: [['mine', 'sm', 2]], imageIds: ['ghost-photo'] },
    });
    await db.chunks.add({ voicemailId: 'ghost', segmentId: 'sg', seq: 0, blob: new Blob(['x']), ms: 1, peaks: [] });
    await db.chunks.add({ voicemailId: 'mine', segmentId: 'sm', seq: 2, blob: new Blob(['x']), ms: 1, peaks: [] });
    await db.images.put({ id: 'ghost-photo', blob: new Blob(['x']), createdAt: 1 });
    expect(await undoInterruptedRestore()).toBe(true);
    const after = await snapshot();
    expect(after.c).toEqual(before.c);
    expect(after.i).toBe(0);
    expect(await db.settings.get(RESTORE_JOURNAL_KEY)).toBeUndefined();
    expect(await undoInterruptedRestore()).toBe(false);
    expect(await text('sm')).toBe('sm-0;sm-1;');
  });
});

describe('a damaged or failing restore never leaves partial data behind', () => {
  /** A backup of a device whose library is quite different from the one we then restore onto. */
  async function setup() {
    await seed('theirs-a', [{ id: 'sa', chunks: 4 }], { title: 'a' });
    await seed('theirs-b', [{ id: 'sb', chunks: 3 }], { title: 'b' });
    const photo = await saveImage(new Blob(['their-photo'], { type: 'image/jpeg' }));
    await db.voicemails.update('theirs-a', { coverId: photo });
    const col = await createCollection('theirs');
    await addToCollection(col, 'theirs-a');
    await db.settings.put({ key: 'name', value: 'their name' });
    const zip = await backup();
    await clearAll();
    await seed('mine', [{ id: 'sm', chunks: 3 }], { title: 'mine' });
    await db.settings.put({ key: 'name', value: 'my name' });
    await db.images.put({ id: 'my-photo', blob: new Blob(['mine-photo']), createdAt: 7 });
    return zip;
  }

  it('a backup cut short at ANY point either restores completely or changes nothing at all', async () => {
    const zip = await setup();
    const plan = await analyzeBackup(zip); // analysed from the intact file, then restored from a damaged copy
    const bytes = new Uint8Array(await zip.arrayBuffer());
    const before = await deepSnapshot();
    const wanted = plan.manifest.chunks.length;
    let rejected = 0;
    for (let pct = 5; pct <= 95; pct += 5) {
      const damaged = new Blob([bytes.slice(0, Math.floor((bytes.length * pct) / 100))]);
      let ok = true;
      await restoreBackup(damaged, plan, { ...plan.defaults, includeMissing: true, restoreSettings: true }, () => {}).catch(() => (ok = false));
      if (ok) {
        // it only "worked" because every piece really arrived: never a partial voicemail
        expect(await db.chunks.where('voicemailId').anyOf(['theirs-a', 'theirs-b']).count(), `cut at ${pct}%`).toBe(wanted);
        break;
      }
      rejected++;
      expect(await deepSnapshot(), `cut at ${pct}%`).toEqual(before);
      expect(await db.settings.get(RESTORE_JOURNAL_KEY), `journal left after ${pct}%`).toBeUndefined();
    }
    expect(rejected).toBeGreaterThan(5); // the cuts that matter really were exercised
  });

  it('a failure after ANY number of audio pieces were saved puts the whole database back', async () => {
    const zip = await setup();
    const plan = await analyzeBackup(zip);
    const before = await deepSnapshot();
    const pieces = plan.manifest.chunks.length;
    for (let failAt = 1; failAt <= pieces; failAt++) {
      const real = db.chunks.add.bind(db.chunks);
      let n = 0;
      const spy = vi.spyOn(db.chunks, 'add').mockImplementation(((row: never) => (++n === failAt ? Promise.reject(new Error(`disk error at piece ${failAt}`)) : real(row))) as never);
      await expect(restoreBackup(zip, plan, { ...plan.defaults, includeMissing: true, restoreSettings: true }, () => {})).rejects.toThrow('nothing was changed');
      spy.mockRestore();
      expect(await deepSnapshot(), `failure at piece ${failAt}`).toEqual(before);
    }
  });

  it('a failure while making the restore visible (every table at once) changes nothing', async () => {
    const zip = await setup();
    const plan = await analyzeBackup(zip);
    const before = await deepSnapshot();
    const failures: [string, () => { mockRestore(): void }][] = [
      ['voicemails', () => vi.spyOn(db.voicemails, 'bulkAdd').mockRejectedValue(new Error('voicemails failed'))],
      ['collections', () => vi.spyOn(db.collections, 'bulkAdd').mockRejectedValue(new Error('collections failed'))],
      ['settings', () => vi.spyOn(db.settings, 'bulkPut').mockRejectedValue(new Error('settings failed'))],
    ];
    for (const [table, fail] of failures) {
      const spy = fail();
      await expect(restoreBackup(zip, plan, { ...plan.defaults, includeMissing: true, restoreSettings: true }, () => {})).rejects.toThrow('nothing was changed');
      spy.mockRestore();
      expect(await deepSnapshot(), `${table} failed`).toEqual(before);
    }
  });

  it('even when the in-process undo cannot run (a crash), the next start restores the database exactly', async () => {
    const zip = await setup();
    const plan = await analyzeBackup(zip);
    const before = await deepSnapshot();
    const real = db.chunks.add.bind(db.chunks);
    let n = 0;
    vi.spyOn(db.chunks, 'add').mockImplementation(((row: never) => (++n === 4 ? Promise.reject(new Error('power cut')) : real(row))) as never);
    // the undo's own transaction fails too — as if the app had died at that moment
    vi.spyOn(db, 'transaction').mockRejectedValueOnce(new Error('app died') as never);
    // the person is told recovery is pending — not that "nothing was changed", which would be untrue
    const failure = await restoreBackup(zip, plan, { ...plan.defaults, includeMissing: true }, () => {}).catch((e: Error) => e);
    expect((failure as Error).message).toBe("that backup couldn't be restored, and putting things back isn't finished yet. close and reopen unspoken so it can finish.");
    expect((failure as Error).message).not.toContain('nothing was changed');
    vi.restoreAllMocks();
    expect(await db.settings.get(RESTORE_JOURNAL_KEY)).toBeDefined(); // the journal survived, with pieces still in the database
    expect((await db.chunks.count()) > 3).toBe(true);
    expect(await undoInterruptedRestore()).toBe(true); // "next start"
    expect(await deepSnapshot()).toEqual(before);
  });

  it('a failure part-way through recovering audio for a voicemail that already exists removes only the pieces just added', async () => {
    // this device has a voicemail that kept pieces 0 and 2 of 5; the backup has all of them
    await seed('mine', [{ id: 'sm', chunks: 5 }], { title: 'mine' });
    await seed('bystander', [{ id: 'sb2', chunks: 2 }], { title: 'untouched' });
    await db.settings.put({ key: 'name', value: 'my name' });
    await db.images.put({ id: 'my-photo', blob: new Blob(['mine-photo']), createdAt: 7 });
    const col = await createCollection('mine too');
    await addToCollection(col, 'mine');
    const zip = await backup();
    await db.chunks.where('segmentId').equals('sm').filter((c) => [1, 3, 4].includes(c.seq)).delete();
    const before = await deepSnapshot();
    expect(await db.chunks.where('segmentId').equals('sm').count()).toBe(2);

    const plan = await analyzeBackup(zip);
    const real = db.chunks.add.bind(db.chunks);
    let attempts = 0;
    let saved = 0;
    vi.spyOn(db.chunks, 'add').mockImplementation(((row: never) => {
      if (++attempts === 2) return Promise.reject(new Error('disk error on the second missing piece'));
      saved++;
      return real(row);
    }) as never);
    // the real restore path: it works out the missing pieces and writes its own journal
    await expect(restoreBackup(zip, plan, plan.defaults, () => {})).rejects.toThrow('nothing was changed');
    vi.restoreAllMocks();

    expect(saved).toBe(1); // one new piece really was written before the failure, so there was something to undo
    expect((await db.chunks.where('segmentId').equals('sm').toArray()).map((c) => c.seq).sort()).toEqual([0, 2]);
    expect(await text('sm')).toBe('sm-0;sm-2;'); // the original pieces, byte for byte
    expect(await deepSnapshot()).toEqual(before); // every other table too
    expect(await db.settings.get(RESTORE_JOURNAL_KEY)).toBeUndefined();

    // and the same restore, once the disk behaves, brings the pieces back
    const { result } = await restore(zip);
    expect(result.summary.recovered).toBe(1);
    expect(await text('sm')).toBe('sm-0;sm-1;sm-2;sm-3;sm-4;');
  });

  it.each([
    ['a general error', () => new Error('db is closed')],
    ['the device being out of space', () => new DOMException('full', 'QuotaExceededError')],
  ])('if the safety journal cannot be written (%s), the restore does not start and changes nothing', async (_name, makeError) => {
    const zip = await setup();
    const plan = await analyzeBackup(zip);
    const before = await deepSnapshot();
    const realPut = db.settings.put.bind(db.settings);
    vi.spyOn(db.settings, 'put').mockImplementation(((row: { key: string }) => (row.key === RESTORE_JOURNAL_KEY ? Promise.reject(makeError()) : realPut(row as never))) as never);
    const addPiece = vi.spyOn(db.chunks, 'add');
    await expect(restoreBackup(zip, plan, { ...plan.defaults, includeMissing: true, restoreSettings: true }, () => {})).rejects.toThrow("that backup couldn't be restored. nothing was changed.");
    expect(addPiece).not.toHaveBeenCalled(); // no audio was even attempted
    vi.restoreAllMocks();
    expect(await deepSnapshot()).toEqual(before);
    expect(await db.settings.get(RESTORE_JOURNAL_KEY)).toBeUndefined();
    // nothing is stuck: with the disk fine again, the same restore completes
    await restoreBackup(zip, plan, { ...plan.defaults, includeMissing: true, restoreSettings: true }, () => {});
    expect(await db.voicemails.get('theirs-a')).toBeTruthy();
  });

  describe('an undo that did not finish', () => {
    /** A restore that fails part-way AND whose own undo fails, so its journal is all that is left. */
    async function leaveUnfinishedRestore() {
      const zip = await setup();
      const plan = await analyzeBackup(zip);
      const before = await deepSnapshot();
      const real = db.chunks.add.bind(db.chunks);
      let n = 0;
      vi.spyOn(db.chunks, 'add').mockImplementation(((row: never) => (++n === 4 ? Promise.reject(new Error('power cut')) : real(row))) as never);
      vi.spyOn(db, 'transaction').mockRejectedValueOnce(new Error('the undo failed too') as never);
      await expect(restoreBackup(zip, plan, { ...plan.defaults, includeMissing: true }, () => {})).rejects.toThrow(/putting things back isn't finished yet\. close and reopen unspoken/);
      vi.restoreAllMocks();
      const journal = await db.settings.get(RESTORE_JOURNAL_KEY);
      expect(journal, 'the journal must survive a failed undo').toBeDefined();
      return { zip, plan, before, journal, left: await deepSnapshot() };
    }

    it('keeps its journal when the undo fails, and a failing recovery does not delete it either', async () => {
      const { journal, left } = await leaveUnfinishedRestore();
      expect((journal!.value as { newVoicemailIds: string[] }).newVoicemailIds.sort()).toEqual(['theirs-a', 'theirs-b']);
      vi.spyOn(db, 'transaction').mockRejectedValueOnce(new Error('still failing') as never);
      await expect(undoInterruptedRestore()).rejects.toThrow('still failing');
      vi.restoreAllMocks();
      expect(await db.settings.get(RESTORE_JOURNAL_KEY)).toEqual(journal); // untouched: recovery was not confirmed
      expect(await deepSnapshot()).toEqual(left);
    });

    it('refuses another restore while it is unresolved, and never overwrites that journal', async () => {
      await seed('another', [{ id: 'sx', chunks: 2 }]);
      const other = await backup(); // a different backup, made before the unfinished restore below
      await clearAll();
      const { zip, plan, journal, left } = await leaveUnfinishedRestore();
      const otherPlan = await analyzeBackup(other);
      const addPiece = vi.spyOn(db.chunks, 'add');
      const putJournal = vi.spyOn(db.settings, 'put');
      const attempts: [string, Blob, typeof plan, RestoreOptions][] = [
        ['same backup', zip, plan, { ...plan.defaults, includeMissing: true }],
        ['same backup, everything on', zip, plan, { ...plan.defaults, includeMissing: true, includeErased: true, restoreSettings: true }],
        ['a different backup', other, otherPlan, { ...otherPlan.defaults, includeMissing: true }],
      ];
      for (const [name, file, p, opts] of attempts) {
        await expect(restoreBackup(file, p, opts, () => {}), name).rejects.toThrow('a previous restore is still being undone. close and reopen unspoken, then try again.');
      }
      expect(putJournal).not.toHaveBeenCalled(); // no new journal was written over the old one
      expect(addPiece).not.toHaveBeenCalled(); // and no audio was touched
      vi.restoreAllMocks();
      expect(await db.settings.get(RESTORE_JOURNAL_KEY)).toEqual(journal);
      expect(await deepSnapshot()).toEqual(left);
    });

    it('allows the next restore once the undo is confirmed', async () => {
      const { zip, plan, before } = await leaveUnfinishedRestore();
      await expect(restoreBackup(zip, plan, { ...plan.defaults, includeMissing: true }, () => {})).rejects.toThrow('previous restore');
      expect(await undoInterruptedRestore()).toBe(true); // "next start": the recovery succeeds
      expect(await db.settings.get(RESTORE_JOURNAL_KEY)).toBeUndefined();
      expect(await deepSnapshot()).toEqual(before);
      await restoreBackup(zip, plan, { ...plan.defaults, includeMissing: true }, () => {});
      expect(await db.voicemails.get('theirs-a')).toBeTruthy();
      expect(await db.settings.get(RESTORE_JOURNAL_KEY)).toBeUndefined();
    });
  });

  it('a completed restore leaves no journal, and the same restore again changes nothing', async () => {
    const zip = await setup();
    const plan = await analyzeBackup(zip);
    await restoreBackup(zip, plan, { ...plan.defaults, includeMissing: true }, () => {});
    expect(await db.settings.get(RESTORE_JOURNAL_KEY)).toBeUndefined();
    const after = await deepSnapshot();
    const again = await restoreBackup(zip, plan, { ...plan.defaults, includeMissing: true }, () => {});
    expect(again.nothingToDo).toBe(true);
    expect(await deepSnapshot()).toEqual(after);
  });
});
