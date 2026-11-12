import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/db';
import {
  addToCollection,
  createCollection,
  deleteCollection,
  deleteVoicemail,
  moveInCollection,
  newVoicemail,
  rebuildFromChunks,
  recoverInterruptedRecordings,
  saveImage,
  segmentBlob,
} from '../src/db/repo';

async function seedRecording(id: string, status: 'recording' | 'saved', segments: { id: string; chunks: number }[]) {
  await db.voicemails.add(newVoicemail({ id, status, segments: segments.map((s) => ({ id: s.id, mimeType: 'audio/webm', durationMs: 0 })) }));
  for (const s of segments) {
    for (let i = 0; i < s.chunks; i++) {
      await db.chunks.add({ voicemailId: id, segmentId: s.id, seq: i, blob: new Blob([`${s.id}-${i};`]), ms: 2000, peaks: [i / 10] });
    }
  }
}

beforeEach(async () => {
  await Promise.all([db.voicemails.clear(), db.chunks.clear(), db.images.clear(), db.collections.clear(), db.settings.clear()]);
});

describe('recording persistence', () => {
  it('rebuilds duration, segments and peaks from saved chunks', async () => {
    await seedRecording('v1', 'saved', [
      { id: 's1', chunks: 3 },
      { id: 's2', chunks: 2 },
    ]);
    const vm = await rebuildFromChunks('v1');
    expect(vm?.durationMs).toBe(10_000);
    expect(vm?.segments.map((s) => s.durationMs)).toEqual([6000, 4000]);
    expect(vm?.peaks).toEqual([0, 0.1, 0.2, 0, 0.1]);
  });

  it('joins chunks in order into one playable blob per segment', async () => {
    await seedRecording('v1', 'saved', [{ id: 's1', chunks: 3 }]);
    const blob = await segmentBlob('s1', 'audio/webm');
    expect(await blob.text()).toBe('s1-0;s1-1;s1-2;');
  });

  it('turns interrupted recordings into drafts instead of losing them', async () => {
    await seedRecording('crashed', 'recording', [{ id: 'sx', chunks: 4 }]);
    await db.voicemails.add(newVoicemail({ id: 'empty', status: 'recording' }));
    expect(await recoverInterruptedRecordings()).toBe(1);
    const vm = await db.voicemails.get('crashed');
    expect(vm?.status).toBe('draft');
    expect(vm?.durationMs).toBe(8000);
    expect(await db.voicemails.get('empty')).toBeUndefined();
  });

  it('deletes a voicemail with its audio, images and collection memberships', async () => {
    await seedRecording('v1', 'saved', [{ id: 's1', chunks: 2 }]);
    const cover = await saveImage(new Blob(['img']));
    await db.voicemails.update('v1', { coverId: cover });
    const col = await createCollection('people i love');
    await addToCollection(col, 'v1');
    await deleteVoicemail('v1');
    expect(await db.chunks.count()).toBe(0);
    expect(await db.images.get(cover)).toBeUndefined();
    expect((await db.collections.get(col))?.voicemailIds).toEqual([]);
  });
});

describe('collections', () => {
  it('reorders, allows multiple membership, and never deletes voicemails', async () => {
    await seedRecording('a', 'saved', [{ id: 'sa', chunks: 1 }]);
    await seedRecording('b', 'saved', [{ id: 'sb', chunks: 1 }]);
    const c1 = await createCollection('late night thoughts');
    const c2 = await createCollection('little moments');
    await addToCollection(c1, 'a');
    await addToCollection(c1, 'b');
    await addToCollection(c1, 'b'); // no duplicates
    await addToCollection(c2, 'a');
    expect((await db.collections.get(c1))?.voicemailIds).toEqual(['a', 'b']);
    await moveInCollection(c1, 1, -1);
    expect((await db.collections.get(c1))?.voicemailIds).toEqual(['b', 'a']);
    await deleteCollection(c1);
    expect(await db.voicemails.count()).toBe(2);
    expect((await db.collections.get(c2))?.voicemailIds).toEqual(['a']);
  });
});

describe('backup & restore', () => {
  it('round-trips audio, images, collections and settings — but never lock secrets', async () => {
    const { writeBackup, memorySink, importBackup } = await import('../src/lib/backup');
    await seedRecording('v1', 'saved', [{ id: 's1', chunks: 3 }]);
    const img = await saveImage(new Blob(['cover-bytes'], { type: 'image/jpeg' }));
    await db.voicemails.update('v1', { coverId: img, title: 'things i never said' });
    const col = await createCollection('people i love');
    await addToCollection(col, 'v1');
    await db.settings.bulkPut([
      { key: 'name', value: 'rmarydess' },
      { key: 'passcodeHash', value: 'secret' },
    ]);

    const zip = await writeBackup(memorySink());
    expect(zip && zip.size).toBeGreaterThan(100);

    await Promise.all([db.voicemails.clear(), db.chunks.clear(), db.images.clear(), db.collections.clear(), db.settings.clear()]);
    const result = await importBackup(zip!, () => {});
    expect(result.voicemails).toBe(1);
    expect((await db.voicemails.get('v1'))?.title).toBe('things i never said');
    expect(await (await segmentBlob('s1', 'audio/webm')).text()).toBe('s1-0;s1-1;s1-2;');
    expect(await (await db.images.get(img))!.blob.text()).toBe('cover-bytes');
    expect((await db.collections.get(col))?.voicemailIds).toEqual(['v1']);
    expect((await db.settings.get('name'))?.value).toBe('rmarydess');
    expect(await db.settings.get('passcodeHash')).toBeUndefined();

    // restoring twice never duplicates audio
    await importBackup(zip!, () => {});
    expect(await db.chunks.count()).toBe(3);
  });

  it('rejects files that are not unspoken backups', async () => {
    const { importBackup } = await import('../src/lib/backup');
    const { zipSync, strToU8 } = await import('fflate');
    const bogus = new Blob([zipSync({ 'hello.txt': strToU8('hi') }) as BlobPart]);
    await expect(importBackup(bogus, () => {})).rejects.toThrow(/unspoken backup/);
  });
});

describe('recently deleted', () => {
  it('moves to the bin, leaves its collections, and comes back to them on restore', async () => {
    const { moveToDeleted, restoreDeleted } = await import('../src/db/repo');
    await seedRecording('v1', 'saved', [{ id: 's1', chunks: 2 }]);
    const col = await createCollection('people i love');
    await addToCollection(col, 'v1');

    await moveToDeleted('v1');
    const deleted = await db.voicemails.get('v1');
    expect(deleted?.status).toBe('deleted');
    expect(deleted?.deletedCollections).toEqual([col]);
    expect((await db.collections.get(col))?.voicemailIds).toEqual([]);
    expect(await db.chunks.count()).toBe(2); // audio is kept while in the bin

    await restoreDeleted('v1');
    expect((await db.voicemails.get('v1'))?.status).toBe('saved');
    expect((await db.collections.get(col))?.voicemailIds).toEqual(['v1']);
  });

  it('restores a deleted draft as a draft', async () => {
    const { moveToDeleted, restoreDeleted } = await import('../src/db/repo');
    await seedRecording('d1', 'saved', [{ id: 'sd', chunks: 1 }]);
    await db.voicemails.update('d1', { status: 'draft' });
    await moveToDeleted('d1');
    await restoreDeleted('d1');
    expect((await db.voicemails.get('d1'))?.status).toBe('draft');
  });

  it('erases only what has been in the bin for over 30 days', async () => {
    const { moveToDeleted, purgeOldDeleted } = await import('../src/db/repo');
    await seedRecording('old', 'saved', [{ id: 'so', chunks: 2 }]);
    await seedRecording('new', 'saved', [{ id: 'sn', chunks: 2 }]);
    await moveToDeleted('old');
    await moveToDeleted('new');
    await db.voicemails.update('old', { deletedAt: Date.now() - 31 * 86_400_000 });
    expect(await purgeOldDeleted()).toBe(1);
    expect(await db.voicemails.get('old')).toBeUndefined();
    expect(await db.voicemails.get('new')).toBeDefined();
    expect(await db.chunks.where('voicemailId').equals('old').count()).toBe(0);
    expect(await db.chunks.where('voicemailId').equals('new').count()).toBe(2);
  });
});

describe('restoring backups safely', () => {
  it('still restores backups made by the first version (manifest at the end)', async () => {
    const { importBackup } = await import('../src/lib/backup');
    const { zipSync, strToU8 } = await import('fflate');
    const vm = newVoicemail({ id: 'legacy', status: 'saved', title: 'an old backup', segments: [{ id: 'sl', mimeType: 'audio/webm', durationMs: 2000 }] });
    const manifest = {
      format: 'unspoken-backup',
      version: 1,
      exportedAt: Date.now(),
      voicemails: [vm],
      collections: [],
      settings: [],
      chunks: [{ voicemailId: 'legacy', segmentId: 'sl', seq: 0, ms: 2000, peaks: [0.5], file: 'audio/legacy/sl-000000.bin', type: 'audio/webm' }],
      images: [],
    };
    // object key order = file order in the zip: audio first, manifest last
    const zip = zipSync({ 'audio/legacy/sl-000000.bin': strToU8('legacy-audio'), 'manifest.json': strToU8(JSON.stringify(manifest)) });
    await importBackup(new Blob([zip as BlobPart]), () => {});
    expect((await db.voicemails.get('legacy'))?.title).toBe('an old backup');
    expect(await (await segmentBlob('sl', 'audio/webm')).text()).toBe('legacy-audio');
  });

  it('leaves everything as it was when a backup is broken', async () => {
    const { writeBackup, memorySink, importBackup } = await import('../src/lib/backup');
    await seedRecording('v1', 'saved', [{ id: 's1', chunks: 3 }]);
    const zip = (await writeBackup(memorySink()))!;
    const bytes = new Uint8Array(await zip.arrayBuffer());
    const broken = new Blob([bytes.slice(0, Math.floor(bytes.length * 0.6))]); // cut off part-way through
    await expect(importBackup(broken, () => {})).rejects.toThrow();
    expect(await db.chunks.count()).toBe(3);
    expect(await (await segmentBlob('s1', 'audio/webm')).text()).toBe('s1-0;s1-1;s1-2;');
  });
});

describe('restoring an incomplete backup', () => {
  it('refuses a backup whose audio is missing, and keeps the audio already here', async () => {
    const { importBackup } = await import('../src/lib/backup');
    const { zipSync, strToU8 } = await import('fflate');
    await seedRecording('v1', 'saved', [{ id: 's1', chunks: 2 }]);
    const vm = await db.voicemails.get('v1');
    const manifest = {
      format: 'unspoken-backup',
      version: 1,
      exportedAt: Date.now(),
      voicemails: [vm],
      collections: [],
      settings: [],
      chunks: [0, 1].map((seq) => ({ voicemailId: 'v1', segmentId: 's1', seq, ms: 2000, peaks: [], file: `audio/v1/s1-00000${seq}.bin`, type: 'audio/webm' })),
      images: [],
    };
    const zip = zipSync({ 'manifest.json': strToU8(JSON.stringify(manifest)), 'audio/v1/s1-000000.bin': strToU8('only-one') });
    await expect(importBackup(new Blob([zip as BlobPart]), () => {})).rejects.toThrow(/couldn't be restored/);
    expect(await (await segmentBlob('s1', 'audio/webm')).text()).toBe('s1-0;s1-1;');
  });
});

describe('a restore that fails at the last step', () => {
  it('removes the audio and photos it added, so nothing plays twice', async () => {
    const { writeBackup, memorySink, importBackup } = await import('../src/lib/backup');
    await seedRecording('v1', 'saved', [{ id: 's1', chunks: 3 }]);
    await db.images.put({ id: 'old-photo', blob: new Blob(['p']), createdAt: 1 });
    const zip = (await writeBackup(memorySink()))!;
    await db.images.delete('old-photo'); // so the restore has a photo to add
    const original = db.voicemails.bulkPut.bind(db.voicemails);
    db.voicemails.bulkPut = (() => Promise.reject(new Error('disk full'))) as typeof db.voicemails.bulkPut;
    try {
      await expect(importBackup(zip, () => {})).rejects.toThrow('nothing was changed');
    } finally {
      db.voicemails.bulkPut = original;
    }
    expect(await db.chunks.count()).toBe(3);
    expect(await db.images.count()).toBe(0);
    expect(await (await segmentBlob('s1', 'audio/webm')).text()).toBe('s1-0;s1-1;s1-2;');
  });
});
