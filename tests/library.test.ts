import { describe, expect, it } from 'vitest';
import { newVoicemail } from '../src/db/repo';
import type { Collection } from '../src/db/types';
import { defaultTitle, formatDuration, fromDateTimeInputs, greeting, timeAgo } from '../src/lib/format';
import { downsamplePeaks, EMPTY_FILTERS, filterVoicemails, pickEcho, sortVoicemails, unlockDate } from '../src/lib/library';
import { pickPrompts, PROMPTS } from '../src/lib/prompts';
import { reminderDue } from '../src/lib/notify';

const DAY = 86_400_000;

describe('format', () => {
  it('formats durations including hour-long recordings', () => {
    expect(formatDuration(0)).toBe('00:00');
    expect(formatDuration(163_000)).toBe('02:43');
    expect(formatDuration(3_725_000)).toBe('1:02:05');
    expect(formatDuration(5 * 3_600_000)).toBe('5:00:00');
  });
  it('greets by time of day', () => {
    expect(greeting(new Date(2026, 0, 1, 8))).toBe('good morning.');
    expect(greeting(new Date(2026, 0, 1, 14))).toBe('good afternoon.');
    expect(greeting(new Date(2026, 0, 1, 19))).toBe('good evening.');
    expect(greeting(new Date(2026, 0, 1, 2))).toBe("it's late. what's on your mind?");
    expect(greeting(new Date(2026, 0, 1, 23))).toBe("it's late. what's on your mind?");
  });
  it('gives a gentle default title', () => {
    expect(defaultTitle(new Date(2026, 10, 3, 2).getTime())).toBe('thoughts at 2am');
    expect(defaultTitle(new Date(2026, 10, 3, 19).getTime())).toBe('a tuesday evening');
  });
  it('describes time ago for echoes', () => {
    const now = new Date(2026, 5, 1).getTime();
    expect(timeAgo(now - 370 * DAY, now)).toBe('a year ago');
    expect(timeAgo(now - 95 * DAY, now)).toBe('three months ago');
    expect(timeAgo(now - 8 * DAY, now)).toBe('a week ago');
  });
  it('parses date + time inputs', () => {
    expect(fromDateTimeInputs('2026-03-04', '21:30')).toBe(new Date(2026, 2, 4, 21, 30).getTime());
    expect(fromDateTimeInputs('', '21:30')).toBeNull();
  });
});

describe('library search & sort', () => {
  const a = newVoicemail({
    id: 'a',
    status: 'saved',
    title: 'thoughts at 2am',
    recordedAt: 1000,
    durationMs: 60_000,
    tags: ['night'],
    mood: 'tired',
    transcript: 'i could not sleep again',
  });
  const b = newVoicemail({
    id: 'b',
    status: 'saved',
    title: 'a day worth remembering',
    recordedAt: 3000,
    durationMs: 3_600_000,
    description: 'the beach with mom',
    mood: 'happy',
  });
  const c = newVoicemail({ id: 'c', status: 'saved', title: '', recordedAt: 2000, durationMs: 5_000, lastPlayedAt: 99 });
  const cols: Collection[] = [{ id: 'k', title: 'people i love', description: '', coverId: null, voicemailIds: ['b'], createdAt: 0, updatedAt: 0 }];
  const all = [a, b, c];

  it('searches title, description, transcript, tags and collection names', () => {
    const q = (query: string) => filterVoicemails(all, { ...EMPTY_FILTERS, query }, cols).map((v) => v.id);
    expect(q('2am')).toEqual(['a']);
    expect(q('beach')).toEqual(['b']);
    expect(q('sleep')).toEqual(['a']);
    expect(q('night')).toEqual(['a']);
    expect(q('people i love')).toEqual(['b']);
    expect(q('happy')).toEqual(['b']);
  });
  it('filters by mood, tag, collection and duration', () => {
    expect(filterVoicemails(all, { ...EMPTY_FILTERS, mood: 'tired' }).map((v) => v.id)).toEqual(['a']);
    expect(filterVoicemails(all, { ...EMPTY_FILTERS, tag: 'night' }).map((v) => v.id)).toEqual(['a']);
    expect(filterVoicemails(all, { ...EMPTY_FILTERS, collectionId: 'k' }, cols).map((v) => v.id)).toEqual(['b']);
    expect(filterVoicemails(all, { ...EMPTY_FILTERS, minMinutes: 30 }).map((v) => v.id)).toEqual(['b']);
    expect(filterVoicemails(all, { ...EMPTY_FILTERS, maxMinutes: 1 }).map((v) => v.id)).toEqual(['a', 'c']);
  });
  it('sorts every way the library offers', () => {
    expect(sortVoicemails(all, 'newest').map((v) => v.id)).toEqual(['b', 'c', 'a']);
    expect(sortVoicemails(all, 'oldest').map((v) => v.id)).toEqual(['a', 'c', 'b']);
    expect(sortVoicemails(all, 'longest').map((v) => v.id)).toEqual(['b', 'a', 'c']);
    expect(sortVoicemails(all, 'shortest').map((v) => v.id)).toEqual(['c', 'a', 'b']);
    expect(sortVoicemails(all, 'played')[0].id).toBe('c');
    expect(sortVoicemails(all, 'title').map((v) => v.id)[0]).toBe('b');
  });
});

describe('waveform peaks', () => {
  it('downsamples long recordings by max', () => {
    const peaks = Array.from({ length: 36_000 }, (_, i) => (i === 18_000 ? 1 : 0.1));
    const bars = downsamplePeaks(peaks, 100);
    expect(bars).toHaveLength(100);
    expect(Math.max(...bars)).toBe(1);
  });
  it('stretches short recordings to fill', () => {
    expect(downsamplePeaks([0.2, 0.8], 4)).toEqual([0.2, 0.2, 0.8, 0.8]);
    expect(downsamplePeaks([], 3)).toHaveLength(3);
  });
});

describe('little echoes', () => {
  const now = new Date(2027, 2, 4, 12).getTime();
  it('prefers an anniversary', () => {
    const old = newVoicemail({ id: 'anniv', status: 'saved', recordedAt: new Date(2026, 2, 4, 9).getTime() });
    const other = newVoicemail({ id: 'other', status: 'saved', recordedAt: new Date(2026, 6, 9).getTime() });
    expect(pickEcho([other, old], {}, now)?.id).toBe('anniv');
  });
  it('never echoes recent, dismissed or sealed voicemails', () => {
    const recent = newVoicemail({ id: 'r', status: 'saved', recordedAt: now - DAY });
    const dismissed = newVoicemail({ id: 'd', status: 'saved', recordedAt: now - 100 * DAY });
    const sealed = newVoicemail({ id: 's', status: 'saved', recordedAt: now - 100 * DAY, unlockAt: now + DAY });
    expect(pickEcho([recent, dismissed, sealed], { d: '2027-03-04' }, now)).toBeNull();
  });
});

describe('future me', () => {
  const now = new Date(2026, 10, 4, 21).getTime();
  it('computes unlock dates', () => {
    expect(unlockDate('tomorrow', { now })).toBe(new Date(2026, 10, 5, 8).getTime());
    expect(unlockDate('week', { now })).toBe(new Date(2026, 10, 11, 8).getTime());
    expect(unlockDate('month', { now })).toBe(new Date(2026, 11, 4, 8).getTime());
    expect(unlockDate('newyear', { now })).toBe(new Date(2027, 0, 1, 8).getTime());
    expect(unlockDate('birthday', { now, birthday: '03-15' })).toBe(new Date(2027, 2, 15, 8).getTime());
    expect(unlockDate('birthday', { now, birthday: '12-01' })).toBe(new Date(2026, 11, 1, 8).getTime());
    expect(unlockDate('birthday', { now, birthday: null })).toBeNull();
    expect(unlockDate('custom', { now, custom: '2020-01-01' })).toBeNull();
  });
});

describe('prompts & reminders', () => {
  it('refreshes to different prompts', () => {
    const first = pickPrompts(3);
    const next = pickPrompts(3, first);
    expect(next.some((p) => first.includes(p))).toBe(false);
    expect(PROMPTS).toHaveLength(15);
  });
  it('reminds once a day after the chosen time', () => {
    const at = new Date(2026, 10, 4, 21, 5);
    expect(reminderDue('21:00', null, '2026-11-04', at)).toBe(true);
    expect(reminderDue('21:00', '2026-11-04', '2026-11-04', at)).toBe(false);
    expect(reminderDue('22:00', null, '2026-11-04', at)).toBe(false);
  });
});
