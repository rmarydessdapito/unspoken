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

