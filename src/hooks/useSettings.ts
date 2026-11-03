import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { DEFAULT_SETTINGS, type Settings } from '../db/types';
import { setSetting } from '../db/repo';

/** Live settings object; re-renders whenever any setting changes. */
export function useSettings(): Settings {
  const rows = useLiveQuery(() => db.settings.toArray(), []);
  const s: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows ?? []) s[r.key] = r.value;
  return s as unknown as Settings;
}

/** true / false once known, undefined while the database is still being read */
export function useOnboarded(): boolean | undefined {
  return useLiveQuery(async () => !!(await db.settings.get('onboarded'))?.value, []);
}

export { setSetting };
