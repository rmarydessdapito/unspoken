// Small, pure formatting helpers. All copy is lowercase on purpose — that's the unspoken voice.

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).toLowerCase();
}

export function formatShortDate(ts: number): string {
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toLowerCase();
}

export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
}

export function formatBytes(bytes: number): string {
  if (!bytes) return '0 mb';
  const units = ['b', 'kb', 'mb', 'gb', 'tb'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

export function greeting(date = new Date(), name = ''): string {
  const h = date.getHours();
  const who = name.trim().toLowerCase();
  const late = who ? `it's late, ${who}. what's on your mind?` : "it's late. what's on your mind?";
  if (h < 5) return late;
  const part = h < 12 ? 'morning' : h < 18 ? 'afternoon' : h < 22 ? 'evening' : null;
  if (!part) return late;
  return who ? `good ${part}, ${who}.` : `good ${part}.`;
}

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** A gentle fallback title so a voicemail saved with no text still has a name. */
export function defaultTitle(ts: number): string {
  const d = new Date(ts);
  const h = d.getHours();
  const day = DAYS[d.getDay()];
  if (h < 5) return `thoughts at ${h === 0 ? 12 : h}am`;
  if (h < 12) return `a ${day} morning`;
  if (h < 18) return `a ${day} afternoon`;
  if (h < 22) return `a ${day} evening`;
  return `late on a ${day}`;
}

export function displayTitle(vm: { title: string; recordedAt: number }): string {
  return vm.title.trim() || defaultTitle(vm.recordedAt);
}

/** "a year ago", "three months ago" … for little echoes. */
export function timeAgo(ts: number, now = Date.now()): string {
  const days = Math.floor((now - ts) / 86_400_000);
  const words = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven'];
  const w = (n: number) => words[n] ?? String(n);
  if (days < 1) return 'earlier today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${w(days)} days ago`;
  if (days < 30) {
    const wk = Math.floor(days / 7);
    return wk === 1 ? 'a week ago' : `${w(wk)} weeks ago`;
  }
  if (days < 365) {
    const mo = Math.floor(days / 30);
    return mo === 1 ? 'a month ago' : `${w(mo)} months ago`;
  }
  const yr = Math.floor(days / 365);
  return yr === 1 ? 'a year ago' : `${w(yr)} years ago`;
}

export function toDateInput(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function toTimeInput(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Combine "YYYY-MM-DD" and "HH:MM" into a local timestamp. */
export function fromDateTimeInputs(date: string, time: string): number | null {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = (time || '00:00').split(':').map(Number);
  if (!y || !m || !d) return null;
  const t = new Date(y, m - 1, d, hh || 0, mm || 0).getTime();
  return Number.isFinite(t) ? t : null;
}

export function todayKey(date = new Date()): string {
  return toDateInput(date.getTime());
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** "tomorrow", "in 6 days", "in 3 months", "in 2 years" — for future-me countdowns. */
export function untilText(ts: number, now = Date.now()): string {
  const start = (t: number) => {
    const d = new Date(t);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  const days = Math.round((start(ts) - start(now)) / 86_400_000);
  if (days <= 0) return ts > now ? 'later today' : 'now';
  if (days === 1) return 'tomorrow';
  if (days < 14) return `in ${days} days`;
  if (days < 60) return `in ${Math.round(days / 7)} weeks`;
  if (days < 730) return `in ${Math.round(days / 30.44)} months`;
  return `in ${Math.floor(days / 365.25)} years`;
}
