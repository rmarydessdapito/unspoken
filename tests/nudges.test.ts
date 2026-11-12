import { describe, expect, it } from 'vitest';
import { assessStorage, LOW_STORAGE_BYTES, shouldNudgeBackup } from '../src/lib/nudges';

const DAY = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 10, 12);

describe('backup reminder', () => {
  const base = { savedCount: 8, lastBackupAt: null, dismissedAt: null, now };
  it('stays quiet until there is something worth protecting', () => {
    expect(shouldNudgeBackup({ ...base, savedCount: 4 })).toBe(false);
    expect(shouldNudgeBackup({ ...base, savedCount: 5 })).toBe(true);
  });
  it('suggests a backup when there has never been one, or the last is old', () => {
    expect(shouldNudgeBackup(base)).toBe(true);
    expect(shouldNudgeBackup({ ...base, lastBackupAt: now - 31 * DAY })).toBe(true);
  });
  it('stays quiet after a recent backup', () => {
    expect(shouldNudgeBackup({ ...base, lastBackupAt: now - 3 * DAY })).toBe(false);
  });
  it('stays dismissed for a month, then may return', () => {
    expect(shouldNudgeBackup({ ...base, dismissedAt: now - 2 * DAY })).toBe(false);
    expect(shouldNudgeBackup({ ...base, dismissedAt: now - 31 * DAY })).toBe(true);
  });
});

describe('storage warning', () => {
  it('says nothing when the browser cannot estimate', () => {
    expect(assessStorage(undefined).level).toBe('unknown');
    expect(assessStorage({}).level).toBe('unknown');
    expect(assessStorage({ usage: 5, quota: 0 }).level).toBe('unknown');
    expect(assessStorage({ usage: 5, quota: NaN }).level).toBe('unknown');
  });
  it('is fine with plenty of room', () => {
    expect(assessStorage({ usage: 50e6, quota: 5e9 })).toEqual({ level: 'ok', freeBytes: 5e9 - 50e6 });
  });
  it('warns when little room is left, or the quota is nearly used', () => {
    expect(assessStorage({ usage: 1e9 - LOW_STORAGE_BYTES + 1, quota: 1e9 }).level).toBe('low');
    expect(assessStorage({ usage: 920e6, quota: 1e9 }).level).toBe('low');
    expect(assessStorage({ usage: 2e9, quota: 1e9 })).toEqual({ level: 'low', freeBytes: 0 });
  });
});
