import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../src/db/db';
import { newVoicemail, segmentBlob } from '../src/db/repo';
import { IncompleteRecordingError, VoicemailRecorder, type WriteFailure } from '../src/lib/recorder';

type Internals = {
  state: string;
  voicemailId: string;
  segmentId: string;
  recorder: unknown;
  handleChunk(b: Blob): void;
  currentActiveMs: () => number;
};

/** A recorder wired to the real database but with no microphone: chunks are fed in by hand, 2s apart. */
async function makeRecorder(onWriteFailure?: (f: WriteFailure) => void) {
  const rec = new VoicemailRecorder({ onWriteFailure });
  const r = rec as unknown as Internals;
  const vm = newVoicemail({ segments: [{ id: 'seg', mimeType: 'audio/webm', durationMs: 0 }] });
  await db.voicemails.add(vm);
  r.voicemailId = vm.id;
  r.segmentId = 'seg';
  r.state = 'recording';
  r.recorder = { state: 'inactive', stop() {}, requestData() {} };
  let t = 0;
  r.currentActiveMs = () => (t += 2000);
  return { rec, r, id: vm.id };
}
const feed = (r: Internals, n: number) => {
  for (let i = 0; i < n; i++) r.handleChunk(new Blob([`chunk${i};`]));
};
const quotaError = () => Object.assign(new Error('full'), { name: 'QuotaExceededError' });

beforeEach(async () => {
  await Promise.all([db.voicemails.clear(), db.chunks.clear(), db.images.clear(), db.collections.clear(), db.settings.clear()]);
});
afterEach(() => vi.restoreAllMocks());

describe('recording write failures', () => {
  it('retries a single failed write once and loses nothing', async () => {
    const failures = vi.fn();
    const { rec, r, id } = await makeRecorder(failures);
    const real = db.chunks.add.bind(db.chunks);
    let calls = 0;
    vi.spyOn(db.chunks, 'add').mockImplementation(((row: never) => (++calls === 2 ? Promise.reject(new Error('blip')) : real(row))) as never);
    feed(r, 4);
    await rec.finish();
    const stored = await db.chunks.where('voicemailId').equals(id).toArray();
    expect(stored.map((c) => c.seq)).toEqual([0, 1, 2, 3]);
    expect(failures).not.toHaveBeenCalled();
    expect((await db.voicemails.get(id))?.status).toBe('saved');
    expect((await db.voicemails.get(id))?.durationMs).toBe(8000);
  });

  it('stops after a repeated failure: one report, no gaps, nothing saved as complete', async () => {
    const failures = vi.fn();
    const { rec, r, id } = await makeRecorder(failures);
    const real = db.chunks.add.bind(db.chunks);
    vi.spyOn(db.chunks, 'add').mockImplementation(((row: { seq: number }) => (row.seq >= 2 ? Promise.reject(quotaError()) : real(row as never))) as never);
    feed(r, 6); // chunk 2 fails twice; 3, 4 and 5 arrive afterwards and must be dropped
    const err = await rec.finish().catch((e) => e);
    expect(err).toBeInstanceOf(IncompleteRecordingError);
    expect(err.storedMs).toBe(4000);
    expect(err.quota).toBe(true);
    expect(failures).toHaveBeenCalledTimes(1);
    expect(failures).toHaveBeenCalledWith({ quota: true, storedMs: 4000 });
    const stored = await db.chunks.where('voicemailId').equals(id).toArray();
    expect(stored.map((c) => c.seq)).toEqual([0, 1]);
    const vm = await db.voicemails.get(id);
    expect(vm?.status).toBe('draft');
    expect(vm?.durationMs).toBe(4000);
    expect(vm?.stoppedEarly).toEqual({ at: 4000, reason: 'storage' });
  });

  it('counts consecutive failures as one failure, and keeps what was stored', async () => {
    const failures = vi.fn();
    const { rec, r, id } = await makeRecorder(failures);
    const real = db.chunks.add.bind(db.chunks);
    vi.spyOn(db.chunks, 'add').mockImplementation(((row: { seq: number }) => (row.seq >= 1 ? Promise.reject(new Error('io')) : real(row as never))) as never);
    feed(r, 5);
    const err = await rec.saveDraft();
    expect(err).toBe(id);
    expect(failures).toHaveBeenCalledTimes(1);
    expect(failures.mock.calls[0][0].quota).toBe(false);
    expect(await db.chunks.where('voicemailId').equals(id).count()).toBe(1);
    expect((await db.voicemails.get(id))?.stoppedEarly?.reason).toBe('write');
  });

  it('reports a recording with nothing stored as empty, and leaves no empty voicemail behind', async () => {
    const { rec, r, id } = await makeRecorder();
    vi.spyOn(db.chunks, 'add').mockRejectedValue(quotaError());
    feed(r, 2);
    const err = await rec.finish().catch((e) => e);
    expect(err).toBeInstanceOf(IncompleteRecordingError);
    expect(err.empty).toBe(true);
    expect(await db.voicemails.get(id)).toBeUndefined();
  });

  it('keeps the audio safe when the final save fails, and never reports success', async () => {
    const { rec, r, id } = await makeRecorder();
    feed(r, 3);
    const realUpdate = db.voicemails.update.bind(db.voicemails);
    vi.spyOn(db.voicemails, 'update').mockImplementation(((key: string, changes: { status?: string }) =>
      changes.status === 'saved' ? Promise.reject(quotaError()) : realUpdate(key, changes as never)) as never);
    const err = await rec.finish().catch((e) => e);
    expect(err).toBeInstanceOf(IncompleteRecordingError);
    expect(err.storedMs).toBeGreaterThan(0);
    const vm = await db.voicemails.get(id);
    expect(vm?.status).toBe('draft'); // recoverable, not 'saved'
    expect(await db.chunks.where('voicemailId').equals(id).count()).toBe(3);
  });

  it('does not touch earlier voicemails when a later recording fails', async () => {
    const earlier = newVoicemail({ status: 'saved', durationMs: 4000, segments: [{ id: 'old', mimeType: 'audio/webm', durationMs: 4000 }] });
    await db.voicemails.add(earlier);
    await db.chunks.bulkAdd([
      { voicemailId: earlier.id, segmentId: 'old', seq: 0, blob: new Blob(['old0;']), ms: 2000, peaks: [] },
      { voicemailId: earlier.id, segmentId: 'old', seq: 1, blob: new Blob(['old1;']), ms: 2000, peaks: [] },
    ]);
    const before = await segmentBlob('old', 'audio/webm');
    const { rec, r } = await makeRecorder();
    const real = db.chunks.add.bind(db.chunks);
    vi.spyOn(db.chunks, 'add').mockImplementation(((row: { seq: number }) => (row.seq >= 1 ? Promise.reject(quotaError()) : real(row as never))) as never);
    feed(r, 4);
    await rec.finish().catch(() => {});
    const after = await segmentBlob('old', 'audio/webm');
    expect(after.size).toBe(before.size);
    expect(await after.text()).toBe('old0;old1;');
    const e = await db.voicemails.get(earlier.id);
    expect(e?.status).toBe('saved');
    expect(e?.durationMs).toBe(4000);
  });

  it('recovers an unfinished recording after the browser is killed mid-write', async () => {
    const { r, id } = await makeRecorder();
    feed(r, 3);
    await new Promise((res) => setTimeout(res, 50)); // let writes land, then "kill" without finishing
    expect((await db.voicemails.get(id))?.status).toBe('recording');
    const { recoverInterruptedRecordings } = await import('../src/db/repo');
    await recoverInterruptedRecordings();
    const vm = await db.voicemails.get(id);
    expect(vm?.status).toBe('draft');
    expect(vm?.durationMs).toBe(6000);
  });
});
