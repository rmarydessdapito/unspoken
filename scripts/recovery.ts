/**
 * Recording recovery under failure, in a real Chrome with a fake microphone.
 *
 *   npm run build && npm run test:recovery
 *
 *  1. Chrome is killed outright (SIGKILL — no warning, no cleanup) in the middle of a recording, then relaunched
 *     on the same profile: the recording must come back as an unfinished thought, with its audio playable.
 *  2. The device runs out of space part-way through a recording (every later write fails, retries included),
 *     while an earlier voicemail exists: it must stay saved and playable.
 *  3. A single audio write fails and the automatic retry succeeds: no gap.
 *  4. The final "mark as saved" write fails: reported plainly, recovered at next launch.
 *
 * Checks (✓) are things that must always hold. Notes (·) describe what was observed, so behaviour is on the record.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';
import type { Browser, Page } from 'puppeteer-core';

const PORT = 4180;
const BASE = `http://localhost:${PORT}`;
const chromePath =
  process.env.CHROME_PATH || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(existsSync);
if (!chromePath) throw new Error('Chrome not found — set CHROME_PATH');

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
let passed = 0;
function check(name: string, cond: unknown, detail = ''): void {
  console.log(`${cond ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) throw new Error(`failed: ${name} ${detail}`);
  passed++;
}
const note = (text: string): void => console.log(`  · ${text}`);

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise<void>((resolve, reject) => {
  server.stdout.on('data', (d) => String(d).includes(String(PORT)) && resolve());
  server.on('exit', () => reject(new Error('preview server exited')));
  setTimeout(resolve, 6000);
});

const profiles: string[] = [];
const launch = (userDataDir: string): Promise<Browser> =>
  puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    userDataDir,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-sandbox', '--no-proxy-server', '--disable-background-networking'],
  });
const freshProfile = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'unspoken-profile-'));
  mkdirSync(dir, { recursive: true });
  profiles.push(dir);
  return dir;
};

// ---- helpers that run inside the page, against the app's real IndexedDB
type Wrap = <T>(r: IDBRequest<T>) => Promise<T>;
const idbRun = (page: Page, fn: (idb: IDBDatabase, arg: any, wrap: Wrap) => Promise<any>, arg?: any): Promise<any> =>
  page.evaluate(
    (src, a) =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('unspoken');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const idb = req.result;
          const wrap = (r: IDBRequest) => new Promise((res, rej) => ((r.onsuccess = () => res(r.result)), (r.onerror = () => rej(r.error))));
          new Function('idb', 'arg', 'wrap', `return (${src})(idb, arg, wrap)`)(idb, a, wrap).then(
            (v: any) => (idb.close(), resolve(v)),
            (e: Error) => (idb.close(), reject(e)),
          );
        };
      }),
    fn.toString(),
    arg,
  );

const readState = (page: Page) =>
  idbRun(page, async (idb, _a, wrap) => {
    const tx = idb.transaction(['voicemails', 'chunks'], 'readonly');
    const voicemails: any[] = await wrap(tx.objectStore('voicemails').getAll());
    const chunks: any[] = await wrap(tx.objectStore('chunks').getAll());
    // can the audio that was kept actually be decoded?
    const out: any[] = [];
    for (const v of voicemails) {
      const mine = chunks.filter((c) => c.voicemailId === v.id).sort((a, b) => a.seq - b.seq);
      let decodedMs: number | null = null;
      if (mine.length) {
        try {
          const ctx = new AudioContext();
          const buf = await ctx.decodeAudioData(await new Blob(mine.map((c) => c.blob)).arrayBuffer());
          decodedMs = Math.round(buf.duration * 1000);
          ctx.close();
        } catch {
          decodedMs = null;
        }
      }
      out.push({ id: v.id, status: v.status, durationMs: v.durationMs, chunkCount: mine.length, seqs: mine.map((c) => c.seq), decodedMs });
    }
    return out;
  });

const markOnboarded = (page: Page) =>
  idbRun(page, async (idb, _a, wrap) => {
    const store = idb.transaction('settings', 'readwrite').objectStore('settings');
    await wrap(store.put({ key: 'onboarded', value: true }));
    await wrap(store.put({ key: 'soundEffects', value: false }));
  });

const timerSeconds = async (page: Page): Promise<number> => {
  const t = await page.$eval('.timer', (e) => e.textContent!.trim());
  return t.split(':').map(Number).reduce((a, p) => a * 60 + p, 0);
};
const clickText = async (page: Page, label: string, selector = 'button, a'): Promise<void> => {
  const ok = await page.evaluate(
    (label, selector) => {
      const el = [...document.querySelectorAll<HTMLElement>(selector)].find((e) => e.innerText.trim().toLowerCase() === label);
      el?.click();
      return !!el;
    },
    label,
    selector,
  );
  if (!ok) throw new Error(`could not find "${label}"`);
  await sleep(300);
};

// storage failures injected into the real IndexedDB API, controlled by sessionStorage flags
const injectFaults = (page: Page) =>
  page.evaluateOnNewDocument(() => {
    const quota = () => new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    const toasts: string[] = [];
    (window as any).__toasts = toasts;
    new MutationObserver(() => {
      for (const t of document.querySelectorAll('.toast')) if (!toasts.includes(`${t.textContent}`) || true) (t as any).__seen ? 0 : ((t as any).__seen = true, toasts.push(`${t.textContent}`));
    }).observe(document, { childList: true, subtree: true });
    let chunkAdds = 0;
    const origAdd = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (this: IDBObjectStore, ...args: [any, IDBValidKey?]) {
      if (this.name === 'chunks') {
        chunkAdds++;
        const after = Number(sessionStorage.getItem('failChunksAfter') ?? 1e9);
        const count = Number(sessionStorage.getItem('failChunksCount') ?? 1e9);
        if (chunkAdds > after && chunkAdds <= after + count) throw quota();
      }
      return origAdd.apply(this, args);
    };
    const failVoicemails = (store: string | undefined) => store === 'voicemails' && sessionStorage.getItem('failVoicemailWrites') === '1';
    const origPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args: [any, IDBValidKey?]) {
      if (failVoicemails(this.name)) throw quota();
      return origPut.apply(this, args);
    };
    const origUpdate = IDBCursor.prototype.update;
    IDBCursor.prototype.update = function (this: IDBCursor, value: any) {
      const src: any = this.source;
      if (failVoicemails(src?.objectStore?.name ?? src?.name)) throw quota();
      return origUpdate.call(this, value);
    };
  });

try {
  // ================================================================ 1. Chrome is killed mid-recording
  {
    const dir = freshProfile();
    let browser = await launch(dir);
    let page = await browser.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle0' });
    await markOnboarded(page);
    await page.goto(`${BASE}/record?start=1`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.rec-badge', { timeout: 8000 });
    await sleep(9000);
    const timerAtKill = await timerSeconds(page);
    const proc = browser.process()!;
    proc.kill('SIGKILL'); // no beforeunload, no pagehide, no cleanup
    await sleep(1500);
    for (const f of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) rmSync(join(dir, f), { force: true });
    note(`killed Chrome with SIGKILL at ${timerAtKill}s on the timer`);

    browser = await launch(dir);
    page = await browser.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle0' });
    await sleep(1500);
    const state = await readState(page);
    const vm = state[0];
    check('after a hard kill, the recording is still there', state.length === 1 && !!vm);
    check('…as an unfinished thought, not lost or half-saved', vm.status === 'draft', `status "${vm.status}"`);
    const keptSeconds = vm.durationMs / 1000;
    check('…keeping nearly everything that was said', keptSeconds >= timerAtKill - 4.5, `${keptSeconds.toFixed(1)}s kept of ${timerAtKill}s (loses at most the last unsaved 2s chunk)`);
    check('…and the kept audio decodes as real audio', vm.decodedMs != null && Math.abs(vm.decodedMs - vm.durationMs) < 2500, `${vm.chunkCount} chunks, decodes to ${vm.decodedMs}ms`);
    await page.goto(`${BASE}/drafts`, { waitUntil: 'networkidle0' });
    check('…and it appears under unfinished thoughts', (await page.evaluate(() => document.body.innerText)).includes('continue') || (await page.$$('.draft-row')).length === 1);
    await browser.close();
  }

  // a finished voicemail to protect: every failure scenario below runs *after* this one exists
  const recordPrevious = async (page: Page): Promise<string> => {
    await page.goto(`${BASE}/record?start=1`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.rec-badge', { timeout: 8000 });
    await sleep(5000);
    await clickText(page, 'finish', '.ctrl');
    await page.waitForFunction(() => location.pathname.includes('/customize'), { timeout: 8000 });
    const done = (await readState(page)).find((v: any) => v.status === 'saved');
    if (!done) throw new Error('the earlier recording was not saved');
    return done.id;
  };
  const screenText = async (page: Page) => (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
  const incompletePanel = (page: Page) => page.$eval('[data-testid="incomplete-recording"]', (e) => (e as HTMLElement).innerText.replace(/\s+/g, ' ')).catch(() => null);

  // ================================================================ 2. the device runs out of space part-way through (every later write fails)
  {
    const browser = await launch(freshProfile());
    const page = await browser.newPage();
    await injectFaults(page);
    await page.goto(BASE, { waitUntil: 'networkidle0' });
    await markOnboarded(page);
    const previousId = await recordPrevious(page);
    const before = (await readState(page)).find((v: any) => v.id === previousId);
    await page.evaluate(() => sessionStorage.setItem('failChunksAfter', '2')); // two chunks (≈4s) save, then every write fails, retries included
    await page.goto(`${BASE}/record?start=1`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.rec-badge', { timeout: 8000 });
    await page.waitForSelector('[data-testid="incomplete-recording"]', { timeout: 15000 });
    await sleep(5000); // keep "talking": nothing more should be said, stored, or warned about
    const panel = (await incompletePanel(page)) ?? '';
    note(`the person saw: "${panel}"`);
    const toasts = ((await page.evaluate(() => (window as any).__toasts as string[])) ?? []).filter((t) => /space|trouble|saving/.test(t));
    check('running out of space is explained once, on screen', /stopped at \d\d:\d\d because your device ran out of space/.test(panel));
    check('…it says the audio is kept as an unfinished thought, and that it is not a finished voicemail', panel.includes('unfinished thoughts') && panel.includes("isn't a finished voicemail"));
    check('…with no repeated warning toasts', toasts.length === 0, `${toasts.length} toast(s)`);
    check('…and no success message', !(await screenText(page)).includes('you got it out.'));
    check('…and the recording controls are gone, so nothing more is "recorded" into the void', (await page.$$('.ctrl')).length === 0);
    const state = await readState(page);
    const vm = state.find((v: any) => v.id !== previousId);
    check('everything stored before the failure is kept', !!vm && vm.chunkCount === 2, `${vm?.chunkCount} chunks, ${((vm?.durationMs ?? 0) / 1000).toFixed(1)}s`);
    check('…with no gaps and nothing stored after the failure', !!vm && vm.seqs.join() === '0,1', `seqs [${vm?.seqs.join(', ')}]`);
    check('…marked as an unfinished thought, never as saved', !!vm && vm.status === 'draft', `status "${vm?.status}"`);
    check('the recovered duration is exactly what was stored (no phantom time)', !!vm && vm.decodedMs != null && Math.abs(vm.decodedMs - vm.durationMs) < 2500, `${vm?.durationMs}ms stored vs ${vm?.decodedMs}ms decoded`);
    const stoppedEarly = await idbRun(page, async (idb, id, wrap) => (await wrap(idb.transaction('voicemails').objectStore('voicemails').get(id))).stoppedEarly, vm?.id);
    check('…and flagged as stopped early, so the draft says so', stoppedEarly?.reason === 'storage', JSON.stringify(stoppedEarly));
    const after = state.find((v: any) => v.id === previousId);
    check('the earlier voicemail is untouched and still plays', !!after && after.status === 'saved' && after.chunkCount === before.chunkCount && after.decodedMs === before.decodedMs, `${after?.chunkCount} chunks, ${after?.decodedMs}ms`);
    await page.goto(`${BASE}/drafts`, { waitUntil: 'networkidle0' });
    check('the draft list says it stopped early', (await screenText(page)).includes('stopped early'));
    await browser.close();
  }

  // ================================================================ 3. a single write fails, then storage recovers
  {
    const browser = await launch(freshProfile());
    const page = await browser.newPage();
    await injectFaults(page);
    await page.goto(BASE, { waitUntil: 'networkidle0' });
    await markOnboarded(page);
    await page.evaluate(() => {
      sessionStorage.setItem('failChunksAfter', '2'); // chunk #3 fails once…
      sessionStorage.setItem('failChunksCount', '1'); // …and the automatic retry succeeds
    });
    await page.goto(`${BASE}/record?start=1`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.rec-badge', { timeout: 8000 });
    await sleep(11000);
    check('one failed write does not interrupt the recording', !(await incompletePanel(page)));
    await clickText(page, 'finish', '.ctrl');
    await sleep(3000);
    const vm = (await readState(page))[0];
    note(`chunk sequence kept: [${vm.seqs.join(', ')}]; stored ${vm.durationMs}ms; decodes to ${vm.decodedMs}ms`);
    check('the retry stored it: no gap in the audio', vm.seqs.every((q: number, i: number) => q === i), `[${vm.seqs.join(', ')}]`);
    check('…and the voicemail is saved normally', vm.status === 'saved' && vm.chunkCount >= 4);
    check('…with audio that decodes, matching the stored duration', vm.decodedMs !== null && Math.abs(vm.decodedMs - vm.durationMs) < 2500);
    await browser.close();
  }

  // ================================================================ 4. the final "mark as saved" write fails
  {
    const dir = freshProfile();
    const browser = await launch(dir);
    const page = await browser.newPage();
    await injectFaults(page);
    await page.goto(BASE, { waitUntil: 'networkidle0' });
    await markOnboarded(page);
    await page.goto(`${BASE}/record?start=1`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.rec-badge', { timeout: 8000 });
    await sleep(7000);
    await page.evaluate(() => sessionStorage.setItem('failVoicemailWrites', '1'));
    await clickText(page, 'finish', '.ctrl');
    await page.waitForSelector('[data-testid="incomplete-recording"]', { timeout: 8000 });
    const panel = (await incompletePanel(page)) ?? '';
    note(`when saving failed the person saw: "${panel}"`);
    check('a failed final save is explained in plain words, not as an error code', panel.includes("couldn't finish saving") && panel.includes('safe in unfinished thoughts'));
    check('…and is never reported as success', !(await screenText(page)).includes('you got it out.') && !page.url().includes('/customize'));
    await page.evaluate(() => sessionStorage.removeItem('failVoicemailWrites'));
    await page.goto(BASE, { waitUntil: 'networkidle0' }); // the next launch
    await sleep(1500);
    const vm = (await readState(page))[0];
    check('the recording is recovered on the next launch', !!vm && vm.status !== 'recording' && vm.chunkCount >= 2, `status "${vm?.status}", ${vm?.chunkCount} chunks`);
    check('…with its audio intact', !!vm && vm.decodedMs !== null);
    await browser.close();
  }

  console.log(`\n${passed} checks passed`);
} catch (err) {
  console.error('\n' + (err as Error).message);
  process.exitCode = 1;
} finally {
  server.kill();
  for (const d of profiles) rmSync(d, { recursive: true, force: true });
  process.exit(process.exitCode ?? 0);
}
