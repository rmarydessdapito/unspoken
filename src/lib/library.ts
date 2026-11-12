// Pure logic for searching, sorting, little echoes and future me. Kept free of DB/DOM so it is unit-tested.
import type { Collection, EchoFrequency, SortKey, Voicemail } from '../db/types';
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

/** Sealed "future me" voicemails stay closed until their date. */
export function isLocked(vm: Pick<Voicemail, 'unlockAt'>, now = Date.now()): boolean {
  return vm.unlockAt != null && vm.unlockAt > now;
}

/** Lowercase words with accents removed, so "Café" and "cafe" match. Apostrophes split words the same way on both sides. */
export function searchWords(text: string): string[] {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}#]+/u)
    .map((w) => w.replace(/^#/, ''))
    .filter(Boolean);
}

/**
 * Everything a search can match for one voicemail.
 * A sealed voicemail only reveals that it's sealed and when it opens — never its title, words, mood or tags.
 */
function searchText(vm: Voicemail, collectionTitles: string[], now: number): string {
  if (isLocked(vm, now)) return ['for future me sealed', formatDate(vm.unlockAt!), ...collectionTitles].join(' ');
  return [displayTitle(vm), vm.description, vm.transcript, vm.mood ?? '', vm.tags.join(' '), formatDate(vm.recordedAt), ...collectionTitles].join(' ');
}

export function filterVoicemails(list: Voicemail[], f: LibraryFilters, collections: Collection[] = [], now = Date.now()): Voicemail[] {
  const queryWords = searchWords(f.query);
  const colById = new Map(collections.map((c) => [c.id, c]));
  const colsFor = (id: string) => collections.filter((c) => c.voicemailIds.includes(id)).map((c) => c.title);
  const contentFilter = f.mood || f.tag || f.minMinutes != null || f.maxMinutes != null;

  return list.filter((vm) => {
    // filtering by mood, tag or length would hint at what a sealed voicemail holds
    if (contentFilter && isLocked(vm, now)) return false;
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
    if (!queryWords.length) return true;
    // every word you type must be the start of some word in the voicemail ("beach" finds "beaches"; "2am" doesn't find "12am")
    const words = searchWords(searchText(vm, colsFor(vm.id), now));
    return queryWords.every((q) => words.some((w) => w.startsWith(q)));
  });
}

export function sortVoicemails(list: Voicemail[], sort: SortKey, now = Date.now()): Voicemail[] {
  const title = (v: Voicemail) => (isLocked(v, now) ? 'for future me' : displayTitle(v));
  // tie-breakers keep the order stable, so items never swap places between visits
  const tie = (a: Voicemail, b: Voicemail) => b.recordedAt - a.recordedAt || a.id.localeCompare(b.id);
  const sealedLast = (a: Voicemail, b: Voicemail) => Number(isLocked(a, now)) - Number(isLocked(b, now));
  const by: Record<SortKey, (a: Voicemail, b: Voicemail) => number> = {
    newest: (a, b) => tie(a, b),
    oldest: (a, b) => a.recordedAt - b.recordedAt || a.id.localeCompare(b.id),
    longest: (a, b) => sealedLast(a, b) || b.durationMs - a.durationMs || tie(a, b),
    shortest: (a, b) => sealedLast(a, b) || a.durationMs - b.durationMs || tie(a, b),
    played: (a, b) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0) || tie(a, b),
    title: (a, b) => title(a).localeCompare(title(b), undefined, { sensitivity: 'base' }) || tie(a, b),
  };
  return [...list].sort(by[sort]);
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
/** a voicemail has to be at least this old before it can echo back */
export const ECHO_MIN_AGE_DAYS = 7;
/** after echoing, a voicemail rests this long before it can come back */
export const ECHO_REST_DAYS = 60;

export const ECHO_FREQUENCY_LABELS: Record<EchoFrequency, string> = {
  daily: 'every day',
  often: 'a few times a week',
  weekly: 'once a week',
  off: 'never',
};

/** Which days an echo arrives. "a few times a week" = monday, thursday, saturday; "once a week" = sunday. */
export function echoDueOn(freq: EchoFrequency, date: Date): boolean {
  const d = date.getDay();
  if (freq === 'daily') return true;
  if (freq === 'often') return d === 1 || d === 4 || d === 6;
  if (freq === 'weekly') return d === 0;
  return false;
}

/** The next day (from tomorrow) an echo is due, or null when echoes are off. */
export function nextEchoDay(freq: EchoFrequency, from: Date): Date | null {
  if (freq === 'off') return null;
  for (let i = 1; i <= 7; i++) {
    const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i);
    if (echoDueOn(freq, d)) return d;
  }
  return null;
}

/** Voicemails that could echo: kept, open (not sealed), at least a week old, and not opted out. */
export function echoCandidates(saved: Voicemail[], neverEcho: string[], now = Date.now()): Voicemail[] {
  return saved.filter((v) => v.status === 'saved' && !isLocked(v, now) && now - v.recordedAt >= ECHO_MIN_AGE_DAYS * DAY && !neverEcho.includes(v.id));
}

/**
 * Pick one older voicemail to resurface today.
 * 1. anniversaries — recorded on this date in an earlier year
 * 2. same day of the month
 * 3. anything else, picked steadily for the day
 * Voicemails echoed in the last ECHO_REST_DAYS are skipped, unless every candidate has echoed recently —
 * then the one that echoed longest ago comes back.
 */
export function pickEcho(
  saved: Voicemail[],
  opts: { now?: number; neverEcho?: string[]; history?: { id: string; date: string }[] } = {},
): Voicemail | null {
  const now = opts.now ?? Date.now();
  const today = new Date(now);
  const candidates = echoCandidates(saved, opts.neverEcho ?? [], now);
  if (!candidates.length) return null;

  const lastEchoed = new Map<string, number>();
  for (const h of opts.history ?? []) {
    const [y, m, d] = h.date.split('-').map(Number);
    const t = new Date(y, m - 1, d).getTime();
    if (t > (lastEchoed.get(h.id) ?? 0)) lastEchoed.set(h.id, t);
  }
  const rested = candidates.filter((v) => now - (lastEchoed.get(v.id) ?? 0) >= ECHO_REST_DAYS * DAY);
  const pool = rested.length ? rested : [...candidates].sort((a, b) => (lastEchoed.get(a.id) ?? 0) - (lastEchoed.get(b.id) ?? 0)).slice(0, 1);

  const sameDayOfMonth = (v: Voicemail) => new Date(v.recordedAt).getDate() === today.getDate();
  const sameDate = (v: Voicemail) => sameDayOfMonth(v) && new Date(v.recordedAt).getMonth() === today.getMonth();
  const oldestFirst = (a: Voicemail, b: Voicemail) => a.recordedAt - b.recordedAt;
  const anniversaries = pool.filter(sameDate);
  if (anniversaries.length) return anniversaries.sort(oldestFirst)[0];
  const monthly = pool.filter(sameDayOfMonth);
  if (monthly.length) return monthly.sort(oldestFirst)[0];

  // steady for the whole day, different from day to day
  const todayKey = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;
  let hash = 0;
  for (const ch of todayKey) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const sorted = [...pool].sort((a, b) => a.id.localeCompare(b.id));
  return sorted[hash % sorted.length];
}

/** Days until the first voicemail becomes old enough to echo (null if there's nothing saved yet). */
export function daysUntilFirstEcho(saved: Voicemail[], now = Date.now()): number | null {
  const open = saved.filter((v) => v.status === 'saved' && !isLocked(v, now));
  if (!open.length) return null;
  const oldest = Math.min(...open.map((v) => v.recordedAt));
  return Math.max(0, Math.ceil((oldest + ECHO_MIN_AGE_DAYS * DAY - now) / DAY));
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

/** Furthest date the picker allows. */
export const MAX_UNLOCK_DATE = '2099-12-31';

/** 8:00 am local time on a calendar day. Days past the end of the month are clamped (feb 30 → feb 28/29). */
function at8(y: number, m: number, d: number): number {
  const year = y + Math.floor(m / 12);
  const month = ((m % 12) + 12) % 12;
  const lastDay = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(d, lastDay), 8, 0, 0).getTime();
}

/**
 * When a future-me voicemail opens: 8:00 am local time on the chosen day.
 * Stored as an exact moment, so it opens at the same instant even if the device's time zone changes later.
 */
export function unlockDate(option: UnlockOption, opts: { birthday?: string | null; custom?: string | null; now?: number }): number | null {
  const now = new Date(opts.now ?? Date.now());
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  const addDays = (n: number) => new Date(y, m, d + n, 8, 0, 0).getTime();
  switch (option) {
    case 'tomorrow':
      return addDays(1);
    case 'week':
      return addDays(7);
    case 'month':
      return at8(y, m + 1, d); // jan 31 → feb 28/29, not march 3
    case 'newyear':
      return at8(y + 1, 0, 1);
    case 'birthday': {
      if (!opts.birthday) return null;
      const [bm, bd] = opts.birthday.split('-').map(Number);
      if (!bm || !bd) return null;
      // a feb 29 birthday opens on feb 28 in other years
      let t = at8(y, bm - 1, bd);
      if (t <= now.getTime()) t = at8(y + 1, bm - 1, bd);
      return t;
    }
    case 'custom': {
      if (!opts.custom || opts.custom > MAX_UNLOCK_DATE) return null;
      const [cy, cm, cd] = opts.custom.split('-').map(Number);
      if (!cy || !cm || !cd) return null;
      const t = at8(cy, cm - 1, cd);
      // must be a later calendar day than today, even if it's still before 8am now
      return t >= addDays(1) ? t : null;
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
