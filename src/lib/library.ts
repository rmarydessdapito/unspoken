// Pure logic for searching, sorting, little echoes and future me. Kept free of DB/DOM so it is unit-tested.
import type { Collection, SortKey, Voicemail } from '../db/types';
import { displayTitle, formatDate } from './format';

export interface LibraryFilters {
  query: string;
  mood: string | null;
  tag: string | null;
  collectionId: string | null;
  from: string | null; // YYYY-MM-DD inclusive
  to: string | null; // YYYY-MM-DD inclusive
  minMinutes: number | null;
  maxMinutes: number | null;
}

export const EMPTY_FILTERS: LibraryFilters = {
  query: '',
  mood: null,
  tag: null,
  collectionId: null,
  from: null,
  to: null,
  minMinutes: null,
  maxMinutes: null,
};

export function activeFilterCount(f: LibraryFilters): number {
  return [f.mood, f.tag, f.collectionId, f.from, f.to, f.minMinutes, f.maxMinutes].filter((v) => v !== null && v !== '').length;
}

function dayStart(s: string): number {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

export function filterVoicemails(list: Voicemail[], f: LibraryFilters, collections: Collection[] = []): Voicemail[] {
  const q = f.query.trim().toLowerCase();
  const colById = new Map(collections.map((c) => [c.id, c]));
  const colsFor = (id: string) => collections.filter((c) => c.voicemailIds.includes(id));

  return list.filter((vm) => {
    if (f.mood && vm.mood !== f.mood) return false;
    if (f.tag && !vm.tags.includes(f.tag)) return false;
    if (f.collectionId) {
      const c = colById.get(f.collectionId);
      if (!c || !c.voicemailIds.includes(vm.id)) return false;
    }
    if (f.from && vm.recordedAt < dayStart(f.from)) return false;
    if (f.to && vm.recordedAt >= dayStart(f.to) + 86_400_000) return false;
    if (f.minMinutes != null && vm.durationMs < f.minMinutes * 60_000) return false;
    if (f.maxMinutes != null && vm.durationMs > f.maxMinutes * 60_000) return false;
    if (!q) return true;
    const haystack = [
      displayTitle(vm),
      vm.description,
      vm.transcript,
      vm.mood ?? '',
      vm.tags.join(' '),
      formatDate(vm.recordedAt),
      colsFor(vm.id)
        .map((c) => c.title)
        .join(' '),
    ]
      .join('\n')
      .toLowerCase();
    return q.split(/\s+/).every((word) => haystack.includes(word));
  });
}

export function sortVoicemails(list: Voicemail[], sort: SortKey): Voicemail[] {
  const copy = [...list];
  switch (sort) {
    case 'newest':
      return copy.sort((a, b) => b.recordedAt - a.recordedAt);
    case 'oldest':
      return copy.sort((a, b) => a.recordedAt - b.recordedAt);
    case 'longest':
      return copy.sort((a, b) => b.durationMs - a.durationMs);
    case 'shortest':
      return copy.sort((a, b) => a.durationMs - b.durationMs);
    case 'played':
      return copy.sort((a, b) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0) || b.recordedAt - a.recordedAt);
    case 'title':
      return copy.sort((a, b) => displayTitle(a).localeCompare(displayTitle(b)));
  }
}

export const SORT_LABELS: Record<SortKey, string> = {
  newest: 'newest',
  oldest: 'oldest',
  longest: 'longest',
  shortest: 'shortest',
  played: 'recently played',
  title: 'a → z',
};

/** Reduce a long peaks array to `buckets` bars (max of each bucket). */
export function downsamplePeaks(peaks: number[], buckets: number): number[] {
  if (buckets <= 0) return [];
  if (peaks.length === 0) return new Array(buckets).fill(0.04);
  if (peaks.length <= buckets) {
    // stretch: repeat values so short recordings still fill the bar
    return Array.from({ length: buckets }, (_, i) => peaks[Math.floor((i / buckets) * peaks.length)]);
  }
  const out: number[] = [];
  const size = peaks.length / buckets;
  for (let i = 0; i < buckets; i++) {
    let max = 0;
    const start = Math.floor(i * size);
    const end = Math.max(start + 1, Math.floor((i + 1) * size));
    for (let j = start; j < end; j++) if (peaks[j] > max) max = peaks[j];
    out.push(max);
  }
  return out;
}

// ---------------------------------------------------------------- little echoes

const DAY = 86_400_000;

/**
 * Pick one older voicemail to resurface today.
 * Prefers anniversaries (same day a year / six months / a month ago), then anything older than a week.
 * Deterministic per day so the echo doesn't change every time the app opens.
 */
export function pickEcho(saved: Voicemail[], dismissed: Record<string, string>, now = Date.now()): Voicemail | null {
  const today = new Date(now);
  const todayKey = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;
  const eligible = saved.filter((v) => v.status === 'saved' && (v.unlockAt == null || v.unlockAt <= now) && now - v.recordedAt >= 7 * DAY && !dismissed[v.id]);
  if (!eligible.length) return null;

  const sameDayOfMonth = (v: Voicemail) => new Date(v.recordedAt).getDate() === today.getDate();
  const sameDate = (v: Voicemail) => sameDayOfMonth(v) && new Date(v.recordedAt).getMonth() === today.getMonth();
  const anniversaries = eligible.filter(sameDate);
  if (anniversaries.length) return anniversaries.sort((a, b) => a.recordedAt - b.recordedAt)[0];
  const monthly = eligible.filter(sameDayOfMonth);
  if (monthly.length) return monthly.sort((a, b) => a.recordedAt - b.recordedAt)[0];

  // stable pseudo-random by day
  let hash = 0;
  for (const ch of todayKey) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const sorted = [...eligible].sort((a, b) => a.id.localeCompare(b.id));
  return sorted[hash % sorted.length];
}

// ---------------------------------------------------------------- future me

export type UnlockOption = 'tomorrow' | 'week' | 'month' | 'birthday' | 'newyear' | 'custom';

export const UNLOCK_LABELS: Record<UnlockOption, string> = {
  tomorrow: 'tomorrow',
  week: 'next week',
  month: 'next month',
  birthday: 'my birthday',
  newyear: "new year's day",
  custom: 'a day i choose',
};

/** Returns the unlock timestamp (start of that local day, 8am) for a future me option. */
export function unlockDate(option: UnlockOption, opts: { birthday?: string | null; custom?: string | null; now?: number }): number | null {
  const now = new Date(opts.now ?? Date.now());
  const at8 = (y: number, m: number, d: number) => new Date(y, m, d, 8, 0, 0).getTime();
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  switch (option) {
    case 'tomorrow':
      return at8(y, m, d + 1);
    case 'week':
      return at8(y, m, d + 7);
    case 'month':
      return at8(y, m + 1, d);
    case 'newyear':
      return at8(y + 1, 0, 1);
    case 'birthday': {
      if (!opts.birthday) return null;
      const [bm, bd] = opts.birthday.split('-').map(Number);
      let t = at8(y, bm - 1, bd);
      if (t <= now.getTime()) t = at8(y + 1, bm - 1, bd);
      return t;
    }
    case 'custom': {
      if (!opts.custom) return null;
      const [cy, cm, cd] = opts.custom.split('-').map(Number);
      const t = at8(cy, cm - 1, cd);
      return t > now.getTime() ? t : null;
    }
  }
}

/** Every tag used anywhere, most used first. */
export function allTags(list: Voicemail[]): string[] {
  const counts = new Map<string, number>();
  for (const v of list) for (const t of v.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
}

export function normalizeTag(raw: string): string {
  return raw.trim().replace(/^#/, '').toLowerCase().replace(/\s+/g, ' ').slice(0, 32);
}
