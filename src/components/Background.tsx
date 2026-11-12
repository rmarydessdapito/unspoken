import { useEffect } from 'react';
import { db } from '../db/db';
import { getSettings, setSetting } from '../db/repo';
import { todayKey } from '../lib/format';
import { notify, reminderDue, reminderLine } from '../lib/notify';

/** Runs quietly while the app is open: future-me unlock alerts and the optional daily reminder. */
export async function runBackgroundChecks(now = Date.now()) {
  const s = await getSettings();
  // future me
  const unlocked = await db.voicemails.where('unlockAt').belowOrEqual(now).toArray();
  const fresh = unlocked.filter((v) => v.status === 'saved' && !v.unlockSeen && !s.notifiedUnlocks.includes(v.id));
  if (fresh.length) {
    await setSetting('notifiedUnlocks', [...s.notifiedUnlocks, ...fresh.map((v) => v.id)]);
    for (const v of fresh) await notify('unspoken', 'you have a voicemail from your past self. ♡', `/voicemail/${v.id}`);
  }
  // daily reminder
  const key = todayKey(new Date(now));
  if (s.remindersEnabled && reminderDue(s.reminderTime, s.lastReminderDate, key, new Date(now))) {
    await setSetting('lastReminderDate', key);
    // you're already here — a "want to talk?" notification would just interrupt
    if (document.visibilityState !== 'visible') await notify('unspoken', reminderLine(new Date(now)), '/record');
  }
}

export function Background() {
  useEffect(() => {
    runBackgroundChecks();
    const t = setInterval(() => runBackgroundChecks(), 60_000);
    const onVis = () => document.visibilityState === 'visible' && runBackgroundChecks();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);
  return null;
}
