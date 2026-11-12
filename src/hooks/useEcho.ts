import { useCallback, useEffect } from 'react';
import { setSetting } from '../db/repo';
import type { Voicemail } from '../db/types';
import { todayKey } from '../lib/format';
import { echoCandidates, echoDueOn, nextEchoDay, pickEcho } from '../lib/library';
import { useSettingsStatus } from './useSettings';

/**
 * Today's little echo, shared by the home screen and the echoes page.
 * Once picked it stays the same all day and is written to the echo history, so it won't repeat soon.
 */
export function useTodaysEcho(saved: Voicemail[] | undefined, now: number) {
  const { settings: s, loaded } = useSettingsStatus();
  const date = new Date(now);
  const key = todayKey(date);
  const due = echoDueOn(s.echoFrequency, date);
  const today = s.echoToday?.date === key ? s.echoToday : null;

  let echo: Voicemail | null = null;
  let fresh: Voicemail | null = null; // a new pick that still needs saving
  if (saved && loaded && due && !today?.skipped) {
    const kept = today?.id ? saved.find((v) => v.id === today.id) : undefined;
    if (kept && echoCandidates([kept], s.neverEcho, now).length) echo = kept;
    else {
      fresh = pickEcho(saved, { now, neverEcho: s.neverEcho, history: s.echoHistory });
      echo = fresh;
    }
  }

  useEffect(() => {
    if (!fresh) return;
    setSetting('echoToday', { date: key, id: fresh.id, skipped: false });
    setSetting('echoHistory', [{ id: fresh.id, date: key }, ...s.echoHistory.filter((h) => !(h.id === fresh.id && h.date === key))].slice(0, 100));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fresh?.id, key]);

  const skipToday = useCallback(() => setSetting('echoToday', { date: key, id: echo?.id ?? null, skipped: true }), [key, echo?.id]);
  const neverAgain = useCallback(
    async (id: string) => {
      await setSetting('neverEcho', [...s.neverEcho.filter((x) => x !== id), id]);
      await setSetting('echoToday', { date: key, id, skipped: true });
    },
    [key, s.neverEcho],
  );

  return {
    echo,
    due,
    skippedToday: !!today?.skipped,
    frequency: s.echoFrequency,
    nextDay: nextEchoDay(s.echoFrequency, date),
    history: s.echoHistory.filter((h) => h.date !== key),
    neverEcho: s.neverEcho,
    skipToday,
    neverAgain,
  };
}
