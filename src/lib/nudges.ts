/**
 * Quiet, rule-based nudges. Kept as plain functions so the rules are easy to read and test.
 */

const DAY = 24 * 60 * 60 * 1000;
export const BACKUP_MIN_VOICEMAILS = 5;
export const BACKUP_STALE_DAYS = 30;
export const NUDGE_SNOOZE_DAYS = 30;
/** Below this much room, we mention it before a recording starts. */
export const LOW_STORAGE_BYTES = 100 * 1024 * 1024;

/**
 * Should Home gently suggest a backup? Only once there's something worth protecting,
 * only when there is no recent backup, and never again for a while after it's dismissed.
 */
export function shouldNudgeBackup(opts: { savedCount: number; lastBackupAt: number | null; dismissedAt: number | null; now: number }): boolean {
  const { savedCount, lastBackupAt, dismissedAt, now } = opts;
  if (savedCount < BACKUP_MIN_VOICEMAILS) return false;
  if (lastBackupAt != null && now - lastBackupAt < BACKUP_STALE_DAYS * DAY) return false;
  if (dismissedAt != null && now - dismissedAt < NUDGE_SNOOZE_DAYS * DAY) return false;
  return true;
}

export interface StorageStatus {
  /** 'unknown' when the browser can't tell us — we say nothing in that case. */
  level: 'ok' | 'low' | 'unknown';
  freeBytes: number | null;
}

/** Browsers only *estimate* storage, so this is a hint for a warning — never a promise either way. */
export function assessStorage(est: { usage?: number; quota?: number } | null | undefined): StorageStatus {
  const quota = est?.quota ?? 0;
  if (!est || !Number.isFinite(quota) || quota <= 0) return { level: 'unknown', freeBytes: null };
  const usage = Math.max(0, est.usage ?? 0);
  const free = Math.max(0, quota - usage);
  return { level: free < LOW_STORAGE_BYTES || usage / quota >= 0.9 ? 'low' : 'ok', freeBytes: free };
}

export async function readStorageStatus(): Promise<StorageStatus> {
  try {
    return assessStorage(await navigator.storage?.estimate?.());
  } catch {
    return { level: 'unknown', freeBytes: null };
  }
}
