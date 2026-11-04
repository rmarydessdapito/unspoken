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
