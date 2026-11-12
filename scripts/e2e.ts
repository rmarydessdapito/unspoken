/**
 * End-to-end check of the real app in a real Chrome, using Chrome's fake microphone.
 *
 *   npm run build && npm run test:e2e        (runs this file with node's built-in TypeScript support)
 *   LONG_MINUTES=10 npm run test:e2e     # also runs a long continuous recording
 *   VIEWPORT=1440x900 npm run test:e2e   # same checks on the desktop layout
 *
 * Needs Google Chrome or Chromium installed (set CHROME_PATH if it isn't at a standard location).
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import puppeteer from 'puppeteer-core';
import type { ElementHandle, Page } from 'puppeteer-core';

const PORT = 4179;
const BASE = `http://localhost:${PORT}`;
const OUT = 'e2e-artifacts';
const LONG_MINUTES = Number(process.env.LONG_MINUTES || 0);
mkdirSync(OUT, { recursive: true });

const chromePath =
  process.env.CHROME_PATH ||
  ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(existsSync);
if (!chromePath) throw new Error('Chrome not found — set CHROME_PATH');

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
let passed = 0;
const results: string[] = [];
function check(name: string, cond: unknown, detail: string = ''): void {
  results.push(`${cond ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  console.log(results.at(-1));
  if (!cond) throw new Error(`failed: ${name} ${detail}`);
  passed++;
}

// sample cover art (palette colours only)
const COVER = 'tests/fixtures/cover.jpg';

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise<void>((resolve, reject) => {
  server.stdout.on('data', (d) => String(d).includes(String(PORT)) && resolve());
  server.on('exit', () => reject(new Error('preview server exited')));
  setTimeout(resolve, 6000);
});

const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: true,
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
    '--no-sandbox',
    '--no-proxy-server',
    '--disable-background-networking',
  ],
});

const page: Page = await browser.newPage();
// phone size by default; VIEWPORT=1440x900 runs the same checks on the desktop layout
const [vw, vh] = (process.env.VIEWPORT || '390x844').split('x').map(Number);
await page.setViewport({ width: vw, height: vh, deviceScaleFactor: vw > 800 ? 1 : 2 });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push((e as Error).message));
page.on('dialog', (d) => d.accept());

const text = () => page.evaluate(() => document.body.innerText);
const clickText = async (label: string, selector: string = 'button, a'): Promise<void> => {
  const ok = await page.evaluate(
    (label, selector) => {
      const els = [...document.querySelectorAll<HTMLElement>(selector)];
      const norm = (e) => e.innerText.trim().toLowerCase();
      const el = els.find((e) => norm(e) === label || e.getAttribute('aria-label') === label) ?? els.find((e) => norm(e).includes(label));
      if (el) (el as HTMLElement).click();
      return !!el;
    },
    label,
    selector,
  );
  if (!ok) throw new Error(`could not find "${label}"`);
  await sleep(350);
};
const tap = async (selector: string): Promise<void> => {
  await page.$eval(selector, (e) => e.scrollIntoView({ block: 'center' }));
  await sleep(150);
  await page.click(selector);
  await sleep(200);
};
const timerSeconds = async (): Promise<number> => {
  const t = await page.$eval('.timer', (e) => e.textContent.trim());
  const parts = t.split(':').map(Number);
  return parts.reduce((a, p) => a * 60 + p, 0);
};
const shot = (name: string) => page.screenshot({ path: `${OUT}/${name}.png` });
// runs `fn(voicemails, chunks)` inside the page against the app's real IndexedDB
const dbQuery = (fn: (voicemails: any[], chunks: any[]) => any): Promise<any> =>
  page.evaluate(
    (src) =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('unspoken');
        req.onsuccess = () => {
          const idb = req.result;
          const tx = idb.transaction(['voicemails', 'chunks'], 'readonly');
          const all = (store: string) => new Promise<any[]>((r) => (tx.objectStore(store).getAll().onsuccess = (e) => r((e.target as IDBRequest).result)));
          Promise.all([all('voicemails'), all('chunks')])
            .then(([voicemails, chunks]) => resolve(new Function('voicemails', 'chunks', `return (${src})(voicemails, chunks)`)(voicemails, chunks)))
            .catch(reject);
        };
        req.onerror = () => reject(req.error);
      }),
    fn.toString(),
  );

try {
  // ---------------------------------------------------------------- onboarding
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await sleep(500);
  check('first launch shows onboarding', (await text()).includes('some thoughts are easier to say than to write.'));
  await shot('01-onboarding');
  await clickText('continue');
  check('onboarding screen 2', (await text()).includes("so don't write them."));
  await clickText('continue');
  check('onboarding screen 3', (await text()).includes('just talk.'));
  await clickText('continue');
  check('onboarding screen 4', (await text()).includes('welcome to unspoken.'));
  await shot('02-welcome');
  await clickText('leave your first voicemail');

  // ---------------------------------------------------------------- record + pause + resume
  await page.waitForSelector('.rec-badge', { timeout: 8000 });
  check('recording starts straight away', true);
  // the screen shows "beep…" for about 2 seconds first, so wait for the text instead of guessing a delay
  const listening = await page
    .waitForFunction(() => document.body.innerText.toLowerCase().includes("i'm listening"), { timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  await shot('03-recording');
  check('recording screen says it is listening', listening);
  await sleep(3500);
  const t1 = await timerSeconds();
  check('timer counts up while recording', t1 >= 4, `${t1}s`);
  await clickText('pause');
  check('paused indicator shows', (await text()).toLowerCase().includes('paused') && (await text()).includes('take your time.'));
  const tPaused = await timerSeconds();
  await shot('04-paused');
  await sleep(3000);
  check('timer stops while paused', (await timerSeconds()) === tPaused, `${tPaused}s`);
  await clickText('resume');
  await sleep(4000);
  const t2 = await timerSeconds();
  check('resumes the same recording', t2 >= tPaused + 3, `${t2}s`);
  await clickText('need a little help?');
  check('optional prompts appear', (await page.$$('.prompt-chip')).length === 3);
  await clickText('finish', '.ctrl');

  // ---------------------------------------------------------------- customize
  await page.waitForFunction(() => document.body.innerText.includes('you got it out.'), { timeout: 8000 });
  check('customization screen appears', (await text()).includes('somewhere for this little piece of you.'));
  await page.type('input[name="title"]', 'thoughts at 2am');
  await page.type('textarea[name="description"]', 'recording this because i don’t want to forget how i felt.');
  await clickText('nostalgic', '.chip');
  await page.type('.tag-input', 'night\n');
  const input = (await page.$('[data-testid="cover-gallery-input"]')) as ElementHandle<HTMLInputElement> | null;
  if (!input) throw new Error('cover input not found');
  await input.uploadFile(COVER);
  await page.waitForFunction(() => document.body.innerText.includes('frame it'), { timeout: 5000 });
  await sleep(500);
  await clickText('use this');
  await page.waitForFunction(() => !!document.querySelector('.customize .cover img'), { timeout: 5000 });
  check('cover artwork uploads and crops', true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(300);
  await shot('05-customize');
  await clickText('keep it');

  // ---------------------------------------------------------------- detail + playback
  await page.waitForSelector('.player-card', { timeout: 8000 });
  const detail = await text();
  check('detail page shows title & description', detail.includes('thoughts at 2am') && detail.includes('forget how i felt'));
  const vm1 = await dbQuery((v) => v.find((x) => x.title === 'thoughts at 2am'));
  check('saved with mood and tag', vm1.mood === 'nostalgic' && vm1.tags.includes('night'));
  check('one recording, not split by pausing', vm1.segments.length === 1, `${vm1.segments.length} segment(s)`);
  const expectMs = t2 * 1000;
  check('paused time excluded from duration', Math.abs(vm1.durationMs - expectMs) < 2500, `${(vm1.durationMs / 1000).toFixed(1)}s recorded vs ${t2}s on timer`);
  check('live waveform peaks captured', vm1.peaks.length > 40 && Math.max(...vm1.peaks) > 0.05, `${vm1.peaks.length} peaks`);

  const decoded = await page.evaluate(async (id) => {
    const req = indexedDB.open('unspoken');
    const idb = await new Promise<IDBDatabase>((r) => (req.onsuccess = () => r(req.result)));
    const chunks = await new Promise<any[]>(
      (r) => (idb.transaction('chunks').objectStore('chunks').getAll().onsuccess = (e) => r((e.target as IDBRequest).result)),
    );
    const mine = chunks.filter((c) => c.voicemailId === id).sort((a, b) => a.seq - b.seq);
    const blob = new Blob(
      mine.map((c) => c.blob),
      { type: mine[0].blob.type },
    );
    const buf = await new AudioContext().decodeAudioData(await blob.arrayBuffer());
    return buf.duration;
  }, vm1.id);
  check('saved audio decodes as real audio', Math.abs(decoded * 1000 - vm1.durationMs) < 2500, `${decoded.toFixed(1)}s of audio`);

  await tap('.play-btn.play-lg');
  await sleep(2500);
  const pos = await page.$eval('.player-times span', (e) => e.textContent);
  check('playback runs', pos !== '00:00', `at ${pos}`);
  await sleep(1500); // let the saved toast fade
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(300);
  await shot('06-detail-playing');
  await clickText('1.5x', '.speed');
  check('playback speed changes', await page.$eval('.speed.is-on', (e) => e.textContent === '1.5x'));
  await tap('[aria-label="forward 10 seconds"]');
  await tap('[aria-label="pause"]');

  // ---------------------------------------------------------------- persistence
  await page.goto(`${BASE}/library`, { waitUntil: 'networkidle0' });
  await sleep(600);
  check('voicemail survives a full reload', (await text()).includes('thoughts at 2am'));
  await shot('07-library-grid');
  await page.type('.search input', 'forget');
  await sleep(300);
  check('search finds by description', (await page.$$('.vm-card')).length === 1);
  await page.$eval('.search input', (e) => (e.value = ''));
  await tap('[aria-label="show as list"]');
  await sleep(300);
  check('list view toggles', (await page.$$('.vm-row')).length === 1);
  await shot('08-library-list');
  await tap('[aria-label="show as grid"]');

  // ---------------------------------------------------------------- collections
  await clickText('collections', '.tab');
  await clickText('start a new collection');
  await page.type('.sheet input', 'late night thoughts');
  await clickText('create', '.sheet button');
  await clickText('late night thoughts', 'a');
  await page.waitForFunction(() => location.pathname.startsWith('/collection/'));
  await clickText('add voicemails');
  await clickText('thoughts at 2am', '.menu-item');
  await page.keyboard.press('Escape');
  await sleep(400);
  check('voicemail added to a collection', (await page.$$('.reorder-row')).length === 1);
  await shot('09-collection');

  // ---------------------------------------------------------------- drafts: pause, leave, come back, continue
  await page.goto(`${BASE}/record?start=1`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.rec-badge', { timeout: 8000 });
  await sleep(3500);
  await clickText('pause');
  await clickText('save as an unfinished thought');
  await page.waitForFunction(() => document.body.innerText.includes('unfinished thoughts'), { timeout: 8000 });
  check('draft appears under unfinished thoughts', true);
  await shot('10-home-with-draft');
  await clickText('continue', '.draft-row button');
  await page.waitForFunction(() => document.body.innerText.includes('pick up where you left off'));
  const resumedFrom = await timerSeconds();
  check('draft resumes from where it stopped', resumedFrom >= 3, `${resumedFrom}s`);
  await tap('[aria-label="continue recording"]');
  await page.waitForSelector('.rec-badge', { timeout: 8000 });
  await sleep(3000);
  await clickText('finish', '.ctrl');
  await page.waitForFunction(() => document.body.innerText.includes('you got it out.'), { timeout: 8000 });
  await clickText('keep it');
  await page.waitForSelector('.player-card');
  const draftVm = await dbQuery((v) => v.filter((x) => x.status === 'saved' && x.segments.length === 2)[0]);
  check(
    'continued draft becomes one voicemail',
    !!draftVm && draftVm.durationMs > 5500,
    draftVm && `${(draftVm.durationMs / 1000).toFixed(1)}s across 2 sessions`,
  );
  await tap('[aria-label="forward 10 seconds"]'); // seeking past segment 1
  await tap('.play-btn.play-lg');
  await sleep(1500);
  check('plays across sessions', (await page.$eval('.player-times span', (e) => e.textContent)) !== '00:00');
  await tap('[aria-label="pause"]').catch(() => {});

  // ---------------------------------------------------------------- crash recovery
  await page.goto(`${BASE}/record?start=1`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.rec-badge', { timeout: 8000 });
  await sleep(5000);
  const cdp = await page.createCDPSession();
  await cdp.send('Page.navigate', { url: BASE }); // tab "closed" mid-recording, no clean stop
  await sleep(2500);
  const recovered = await dbQuery((v) => v.filter((x) => x.status === 'draft'));
  check(
    'a recording interrupted by closing the app is kept as a draft',
    recovered.length === 1 && recovered[0].durationMs >= 3000,
    recovered[0] && `${(recovered[0].durationMs / 1000).toFixed(1)}s kept`,
  );
  check('home tells you it was kept', (await text()).includes('unfinished thoughts'));

  // ---------------------------------------------------------------- future me
  await page.goto(`${BASE}/record?start=1`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.rec-badge', { timeout: 8000 });
  await sleep(2000);
  await clickText('finish', '.ctrl');
  await page.waitForFunction(() => document.body.innerText.includes('you got it out.'), { timeout: 8000 });
  await page.type('input[name="title"]', 'i hope future me is okay.');
  await clickText('next week', '.chip');
  check('future me shows when it opens', (await text()).includes('opens') && (await text()).includes('in 7 days'));
  await clickText('keep it');
  await page.waitForFunction(() => document.body.innerText.includes('seal it for future you?'), { timeout: 5000 });
  check('sealing asks for confirmation first', true);
  await clickText('seal it', '.sheet button');
  await page.waitForFunction(() => location.pathname === '/echoes', { timeout: 8000 });
  await sleep(500);
  check('sealed voicemail waits on the future me shelf', (await text()).includes('for future me'));
  const sealed = await dbQuery((v) => v.find((x) => x.title === 'i hope future me is okay.'));
  await page.goto(`${BASE}/voicemail/${sealed.id}`, { waitUntil: 'networkidle0' });
  check('sealed voicemail cannot be opened early', (await text()).includes("this one's sealed."));
  await shot('11-sealed');
  await page.goto(`${BASE}/voicemail/${sealed.id}/customize`, { waitUntil: 'networkidle0' });
  await sleep(400);
  const editValues = await page.evaluate(() => [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')].map((e) => e.value).join(' '));
  check('sealed details stay hidden on the edit page too', !editValues.includes('i hope') && (await text()).includes("this one's sealed"));
  await page.goto(`${BASE}/library`, { waitUntil: 'networkidle0' });
  await page.$eval('.search input', (e) => ((e as HTMLInputElement).value = ''));
  await page.type('.search input', 'i hope');
  await sleep(400);
  check('search never reveals a sealed voicemail’s words', (await page.$$('.vm-card, .vm-row')).length === 0);
  await clickText('clear search and filters');

  // the day arrives: pretend it's already past and open it
  await page.evaluate(async (id) => {
    const req = indexedDB.open('unspoken');
    const idb: IDBDatabase = await new Promise((r) => (req.onsuccess = () => r(req.result)));
    const store = idb.transaction('voicemails', 'readwrite').objectStore('voicemails');
    const vm = await new Promise<any>((r) => (store.get(id).onsuccess = (e) => r((e.target as IDBRequest).result)));
    store.put({ ...vm, unlockAt: Date.now() - 1000 });
    idb.close();
  }, sealed.id);
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await sleep(600);
  check('home announces the voicemail from your past self', (await text()).includes('you have a voicemail from your past self'));
  await page.goto(`${BASE}/voicemail/${sealed.id}`, { waitUntil: 'networkidle0' });
  await sleep(400);
  check('opening it is a moment, not a list item', (await text()).includes('open it'));
  await shot('11b-reveal');
  await clickText('open it');
  await page.waitForSelector('.player-card', { timeout: 5000 });
  check('after opening, it plays like any voicemail', (await text()).includes('i hope future me is okay.'));

  // ---------------------------------------------------------------- recently deleted
  await tap('.action.danger');
  await clickText('delete', '.sheet button');
  await page.waitForFunction(() => location.pathname === '/library', { timeout: 5000 });
  await page.goto(`${BASE}/deleted`, { waitUntil: 'networkidle0' });
  await sleep(400);
  check('deleting moves it to recently deleted', (await text()).includes('i hope future me is okay.'));
  await clickText('restore');
  await sleep(500);
  const restored = await dbQuery((v) => v.find((x) => x.title === 'i hope future me is okay.'));
  check('and it can be restored', restored.status === 'saved');

  // ---------------------------------------------------------------- you / settings & the passcode lock
  await page.goto(`${BASE}/you`, { waitUntil: 'networkidle0' });
  await sleep(800);
  check('settings show storage usage', (await text()).includes('of voice'));
  await shot('12-you');
  await clickText('set a passcode');
  await sleep(300);
  const pins = await page.$$('.sheet input.pin');
  await pins[0].type('2468');
  await pins[1].type('2468');
  await clickText('set passcode', '.sheet button');
  await sleep(1200);
  await page.reload({ waitUntil: 'networkidle0' });
  await sleep(1500);
  check('the passcode lock is up when the app opens', !!(await page.$('.lock-screen input')));
  await page.type('.lock-screen input', '1111');
  await page.keyboard.press('Enter');
  await sleep(600);
  check('a wrong passcode is refused', !!(await page.$('.lock-screen input')) && (await text()).includes("that's not it"));
  await page.$eval('.lock-screen input', (e) => ((e as HTMLInputElement).value = ''));
  await page.type('.lock-screen input', '2468');
  await page.keyboard.press('Enter');
  await sleep(1000);
  check('the right passcode unlocks', !(await page.$('.lock-screen')));
  await clickText('remove lock');
  await sleep(300);
  await page.type('.sheet input.pin', '0000');
  await clickText('remove lock', '.sheet button');
  await sleep(600);
  check('removing the lock needs the current passcode', (await text()).includes("that's not your current passcode"));
  await page.$eval('.sheet input.pin', (e) => ((e as HTMLInputElement).value = ''));
  await page.type('.sheet input.pin', '2468');
  await clickText('remove lock', '.sheet button');
  await sleep(800);
  check('…and then it comes off', (await text()).includes('set a passcode'));

  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await sleep(600);
  await shot('13-home');


  // ================================================================ small details that make it feel finished
  // helper: run code inside the page against the app's real IndexedDB (self-contained functions only)
  const idbRun = (fn: (idb: IDBDatabase, arg: any, wrap: <T>(r: IDBRequest<T>) => Promise<T>) => Promise<any>, arg?: any): Promise<any> =>
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
  await page.evaluateOnNewDocument(() => {
    try {
      const raw = sessionStorage.getItem('fakeStorage');
      if (raw && navigator.storage) {
        if (raw === 'unsupported') Object.defineProperty(navigator.storage, 'estimate', { value: undefined, configurable: true });
        else {
          const est = JSON.parse(raw);
          Object.defineProperty(navigator.storage, 'estimate', { value: async () => est, configurable: true });
        }
      }
      if (sessionStorage.getItem('watchFlash')) {
        const look = () => {
          if (document.body && /nothing here yet/.test(document.body.innerText)) sessionStorage.setItem('flashed', '1');
        };
        new MutationObserver(look).observe(document, { childList: true, subtree: true, characterData: true });
      }
      delete (window as any).showSaveFilePicker; // headless Chrome can't show the save dialog; use the download path phones use
    } catch {
      /* ignore */
    }
  });
  const go = async (path: string) => {
    await page.goto(BASE + path, { waitUntil: 'networkidle0' });
    await sleep(500);
  };
  const setting = (key: string, value: any) => idbRun(async (idb, a, wrap) => wrap(idb.transaction('settings', 'readwrite').objectStore('settings').put({ key: a.key, value: a.value })), { key, value });
  const unsetting = (key: string) => idbRun(async (idb, k, wrap) => wrap(idb.transaction('settings', 'readwrite').objectStore('settings').delete(k)), key);
  const finishAndKeep = async () => {
    await clickText('finish', '.ctrl');
    await page.waitForFunction(() => document.body.innerText.includes('you got it out.'), { timeout: 15_000 });
    await clickText('keep it');
    await page.waitForSelector('.player-card', { timeout: 8000 });
  };

  // ---- gentle backup reminder
  await idbRun(async (idb, _a, wrap) => {
    const store = (m: IDBTransactionMode) => idb.transaction('voicemails', m).objectStore('voicemails');
    const all: any[] = await wrap(store('readonly').getAll());
    const saved = all.filter((v) => v.status === 'saved');
    for (let i = saved.length; i < 6; i++) await wrap(store('readwrite').put({ ...saved[0], id: `seed-${i}`, title: `seed ${i}`, unlockAt: null }));
  });
  await unsetting('lastBackupAt');
  await unsetting('backupNudgeDismissedAt');
  await go('/');
  check('home gently suggests a backup when there is none', !!(await page.$('.nudge')) && (await text()).includes('back them up'));
  check('the reminder is small and does not hide the record button', !!(await page.$('.record-hero')) && ((await page.$eval('.nudge', (e) => e.getBoundingClientRect().height)) as number) < 90);
  await tap('[aria-label="dismiss backup reminder"]');
  check('it can be dismissed in one tap', !(await page.$('.nudge')));
  await go('/');
  check('and stays dismissed after a reload', !(await page.$('.nudge')));
  await unsetting('backupNudgeDismissedAt');
  await setting('lastBackupAt', Date.now() - 2 * 86_400_000);
  await go('/');
  check('no reminder right after a recent backup', !(await page.$('.nudge')));
  await unsetting('lastBackupAt');
  await go('/');
  await clickText('back them up');
  await sleep(700);
  check('the reminder takes you to the backup section', page.url().endsWith('/you') && (await page.evaluate(() => document.activeElement?.id)) === 'backup');

  // ---- no "nothing here yet" flash while the library loads
  await page.evaluate(() => sessionStorage.setItem('watchFlash', '1'));
  for (const path of ['/', '/library']) {
    await page.evaluate(() => sessionStorage.removeItem('flashed'));
    await go(path);
    check(`${path === '/' ? 'home' : 'library'} never flashes an empty message before your voicemails appear`, (await page.evaluate(() => sessionStorage.getItem('flashed'))) === null);
  }
  await page.evaluate(() => sessionStorage.removeItem('watchFlash'));

  // ---- storage warning before recording
  await page.evaluate(() => sessionStorage.setItem('fakeStorage', JSON.stringify({ usage: 960e6, quota: 1e9 })));
  await go('/record?start=1');
  await page.waitForSelector('.notice', { timeout: 5000 });
  const lowText = await text();
  check('low space is mentioned before recording starts', lowText.includes('space is getting tight') && !(await page.$('.rec-badge')));
  check('it is honest that this is only an estimate', lowText.includes("that's only an estimate") && lowText.includes('might not save'));
  await clickText('record anyway');
  await page.waitForSelector('.rec-badge', { timeout: 8000 });
  check('you can still record anyway', true);
  await sleep(2200);
  await finishAndKeep();

  await page.evaluate(() => sessionStorage.setItem('fakeStorage', 'unsupported'));
  await go('/record?start=1');
  await page.waitForSelector('.rec-badge', { timeout: 8000 });
  check('an unsupported storage estimate never blocks or warns', !(await page.$('.notice')));
  await sleep(2200);
  const status = () => page.$eval('main p.sr-only[role="status"]', (e) => e.textContent.trim());
  check('screen readers hear that recording started', (await status()) === 'recording.');
  await clickText('pause', '.ctrl');
  check('…that it paused', (await status()) === 'recording paused.');
  await clickText('resume', '.ctrl');
  check('…and that it resumed', (await status()) === 'recording resumed.');
  check('the timer itself is not read out every second', (await page.$eval('.timer', (e) => e.getAttribute('aria-live'))) === null);
  await sleep(1500);
  await finishAndKeep();

  await page.evaluate(() => sessionStorage.setItem('fakeStorage', JSON.stringify({ usage: 5e6, quota: 5e9 })));
  await go('/record?start=1');
  await page.waitForSelector('.rec-badge', { timeout: 8000 });
  check('plenty of space: no warning', !(await page.$('.notice')));
  await sleep(1500);
  await finishAndKeep();
  await page.evaluate(() => sessionStorage.removeItem('fakeStorage'));

  // ---- playback recovery
  const target = await dbQuery((v) => v.find((x) => x.status === 'saved' && x.segments.length === 1 && x.unlockAt == null && x.durationMs > 3000 && !x.id.startsWith('seed-')));
  const readChunks = () =>
    idbRun(async (idb, id, wrap) => {
      const all: any[] = await wrap(idb.transaction('chunks').objectStore('chunks').getAll());
      const out: any[] = [];
      for (const c of all.filter((x) => x.voicemailId === id)) {
        const bytes = new Uint8Array(await c.blob.arrayBuffer());
        let bin = '';
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        out.push({ id: c.id, voicemailId: c.voicemailId, segmentId: c.segmentId, seq: c.seq, ms: c.ms, peaks: c.peaks, type: c.blob.type, b64: btoa(bin) });
      }
      return out;
    }, target.id);
  const putChunks = (list: any[], garbage = false) =>
    idbRun(async (idb, a, wrap) => {
      const store = idb.transaction('chunks', 'readwrite').objectStore('chunks');
      for (const c of a.list) {
        const blob = a.garbage ? new Blob(['this is not audio'], { type: c.type }) : new Blob([Uint8Array.from(atob(c.b64), (ch) => ch.charCodeAt(0))], { type: c.type });
        await wrap(store.put({ id: c.id, voicemailId: c.voicemailId, segmentId: c.segmentId, seq: c.seq, ms: c.ms, peaks: c.peaks, blob }));
      }
    }, { list, garbage });
  const removeChunks = () =>
    idbRun(async (idb, id, wrap) => {
      const store = idb.transaction('chunks', 'readwrite').objectStore('chunks');
      const all: any[] = await wrap(store.getAll());
      for (const c of all.filter((x) => x.voicemailId === id)) await wrap(store.delete(c.id));
    }, target.id);
  const getRow = () => idbRun(async (idb, id, wrap) => wrap(idb.transaction('voicemails').objectStore('voicemails').get(id)), target.id);
  const beforeRow = await getRow();
  const originals = await readChunks();
  check('found a recording to test recovery with', originals.length > 0, `${originals.length} chunks`);

  // backup first, while everything is healthy
  const dl = resolvePath(OUT, 'downloads');
  rmSync(dl, { recursive: true, force: true });
  mkdirSync(dl, { recursive: true });
  const downloads = await page.createCDPSession();
  await downloads.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dl });
  await go('/you');
  await clickText('back up everything');
  await page.waitForFunction(() => document.body.innerText.includes('backup saved'), { timeout: 30_000 });
  await sleep(800);
  const zips = readdirSync(dl).filter((f) => f.endsWith('.zip'));
  check('a backup file is downloaded and the screen says so', zips.length === 1 && statSync(`${dl}/${zips[0]}`).size > 1000, zips.join(','));
  check('the screen shows when the last backup was made', (await text()).includes('last backup:'));
  await go('/');
  check('the reminder is gone once there is a backup', !(await page.$('.nudge')));

  // audio that can't be decoded
  await putChunks(originals, true);
  await go(`/voicemail/${target.id}`);
  await tap('.play-btn.play-lg');
  await page.waitForSelector('.playback-error', { timeout: 6000 });
  const errText = await page.$eval('.playback-error', (e) => (e as HTMLElement).innerText);
  check('a playback problem is explained, with a way to try again', errText.includes('try again'), errText.replace(/\n/g, ' | '));
  check('a download is offered because the audio is still saved', errText.includes('download it instead'));
  await clickText('try again', '.playback-error button');
  await page.waitForFunction(() => document.querySelector('.playback-error')?.textContent?.includes("still can't play it"), { timeout: 9000 });
  check('a failed retry says so, and that the recording is safe', (await text()).includes('your recording is safe'));
  const afterRow = await getRow();
  const keep = (r: any) => JSON.stringify([r.title, r.description, r.durationMs, r.segments, r.coverId, r.mood, r.tags, r.status]);
  check('the recording and its details are untouched by a failed retry', keep(afterRow) === keep(beforeRow) && (await readChunks()).length === originals.length);
  // the audio comes back (as if a hiccup passed); retry now works and carries on
  await putChunks(originals, false);
  await clickText('try again', '.playback-error button');
  await page.waitForFunction(() => !document.querySelector('.playback-error'), { timeout: 9000 });
  check('retry recovers once the audio can be read', true);
  await tap('.play-btn.play-lg');
  await sleep(1500);
  const playedTo = await page.$eval('.player-times span', (e) => (e as HTMLElement).textContent);
  check('…and it plays again', playedTo !== '00:00', `at ${playedTo}`);

  // audio missing entirely: no download offered (there is nothing to download)
  await removeChunks();
  await go(`/voicemail/${target.id}`);
  await tap('.play-btn.play-lg');
  await page.waitForSelector('.playback-error', { timeout: 6000 });
  check('no download is offered when the audio is gone', !(await text()).includes('download it instead'));

  // restore from the backup made earlier: the audio returns
  await go('/you');
  const restoreInput = (await page.$('input[type="file"]')) as ElementHandle<HTMLInputElement>;
  const junk = resolvePath(OUT, 'not-a-backup.txt');
  writeFileSync(junk, 'hello, i am not a backup');
  await restoreInput.uploadFile(junk);
  await page.waitForSelector('.sheet');
  await page.waitForFunction(() => /doesn.t look like an unspoken backup/.test(document.body.innerText), { timeout: 8000 });
  check('restoring a wrong file is refused with a clear message', true);
  check('…with nothing to confirm, since there is nothing to restore', !(await page.$('.sheet button.btn-gold')));
  check('…and changes nothing', (await readChunks()).length === 0);
  await clickText('close', '.sheet button');
  await (await page.$('input[type="file"]'))!.uploadFile(`${dl}/${zips[0]}`);
  await page.waitForSelector('.restore-list', { timeout: 15_000 });
  const preview = await text();
  check('restoring shows what will happen first, and says nothing is deleted or replaced by default', preview.includes('restore this backup?') && preview.includes('nothing on this device is deleted or replaced unless you choose it'));
  check('…including the audio that will be recovered', /recovered:/.test(preview), preview.slice(0, 300).replace(/\n/g, ' | '));
  check('…and nothing was changed yet', (await readChunks()).length === 0);
  await clickText('restore', '.sheet button.btn-gold');
  await page.waitForFunction(() => /restored: /.test(document.body.innerText), { timeout: 30_000 });
  check('restoring a real backup says how much came back', /restored: \d+ recovered/.test(await text()));
  check('the missing audio is back after the restore', (await readChunks()).length === originals.length);
  await go(`/voicemail/${target.id}`);
  await tap('.play-btn.play-lg');
  await sleep(1500);
  check('…and plays', (await page.$eval('.player-times span', (e) => (e as HTMLElement).textContent)) !== '00:00');

  // ---- keyboard: dialogs keep focus inside, and close with Escape
  await clickText('collect');
  await page.waitForSelector('.sheet');
  let stayed = true;
  for (let i = 0; i < 14; i++) {
    await page.keyboard.press('Tab');
    stayed = stayed && (await page.evaluate(() => !!document.activeElement?.closest('.sheet')));
  }
  check('Tab stays inside an open dialog', stayed);
  await page.keyboard.down('Shift');
  await page.keyboard.press('Tab');
  await page.keyboard.up('Shift');
  check('Shift+Tab does too', await page.evaluate(() => !!document.activeElement?.closest('.sheet')));
  await page.keyboard.press('Escape');
  await sleep(300);
  check('Escape closes it', !(await page.$('.sheet')));

  // ---------------------------------------------------------------- regression sweep: navigation, filters, echoes, empty states, reopening
  // every screen opens, and nothing throws
  const errorsBefore = errors.length;
  for (const [path, needle] of [['/', 'unspoken'], ['/library', 'my unspoken'], ['/library?tab=collections', 'late night thoughts'], ['/drafts', 'unfinished'], ['/deleted', 'recently deleted'], ['/echoes', 'echo'], ['/you', 'backup']] as const) {
    await go(path);
    check(`navigation: ${path} opens`, (await text()).toLowerCase().includes(needle), needle);
  }
  check('…without page errors', errors.length === errorsBefore);
  await go('/this-page-does-not-exist');
  check('an unknown address quietly returns home', new URL(page.url()).pathname === '/');
  await go('/collection/not-a-real-collection');
  await page.waitForFunction(() => /exist anymore/.test(document.body.innerText), { timeout: 5000 }).catch(() => {});
  check('a collection that no longer exists says so', /exist anymore/.test(await text()), (await text()).slice(0, 120).replace(/\n/g, ' | '));
  await go('/voicemail/not-a-real-voicemail');
  await page.waitForFunction(() => !document.body.innerText.includes('loading…'), { timeout: 5000 }).catch(() => {});
  check('a voicemail that no longer exists is explained, not left loading', !(await text()).includes('loading…'), (await text()).slice(0, 100).replace(/\n/g, ' | '));
  await go('/library');
  await page.goBack();
  await sleep(300);
  check('the back button returns to the previous screen', new URL(page.url()).pathname === '/voicemail/not-a-real-voicemail', new URL(page.url()).pathname);

  // search and filters in the real screen
  await go('/library');
  await page.type('input[aria-label="search voicemails"]', 'zzzqqq');
  await sleep(400);
  check('search with no match explains itself', (await text()).includes('nothing matches “zzzqqq”'));
  await page.focus('input[aria-label="search voicemails"]');
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  await sleep(300);
  const withMood = await dbQuery((v) => v.find((x) => x.mood && x.status === 'saved'));
  if (withMood) {
    await page.click('[aria-label="filters"]');
    await page.waitForSelector('.sheet');
    await clickText(withMood.mood, '.sheet .chip');
    await page.keyboard.press('Escape');
    await sleep(400);
    check('filtering by mood keeps matching voicemails', (await text()).includes(withMood.title || ''));
    check('…and shows the filter is on', !!(await page.$('[aria-label="filters"].has-badge')));
    await page.click('[aria-label="filters"]');
    await page.waitForSelector('.sheet');
    await clickText(withMood.mood, '.sheet .chip');
    await page.keyboard.press('Escape');
    await sleep(300);
    check('…and turns off again', !(await page.$('[aria-label="filters"].has-badge')));
  }

  // little echoes: an old voicemail comes back, can be skipped for today, and the skip survives a reload
  const oldId = 'e2e-old-thought';
  await idbRun(
    async (idb, id, wrap) => {
      const long = Date.now() - 400 * 86_400_000;
      const base = { id, status: 'saved', createdAt: long, recordedAt: long, updatedAt: long, title: 'an old thought', description: '', mood: null, tags: [], coverId: null, photoIds: [], durationMs: 4000, segments: [], peaks: [], transcript: '', transcriptVisible: true, prompt: null, unlockAt: null, unlockSeen: false, lastPlayedAt: null, playCount: 0 };
      await wrap(idb.transaction('voicemails', 'readwrite').objectStore('voicemails').put(base));
    },
    oldId,
  );
  await setting('echoFrequency', 'daily');
  await unsetting('echoToday');
  await go('/echoes');
  check('an old voicemail resurfaces as an echo', !!(await page.$('.echo-card')) && (await text()).includes('an old thought'), (await text()).slice(0, 160).replace(/\n/g, ' | '));
  await clickText('not today');
  await page.waitForFunction(() => document.body.innerText.includes('another day'), { timeout: 5000 });
  check('"not today" puts it away for the day', !(await page.$('.echo-card')));
  await go('/echoes');
  check('…and it stays put after reopening the app', !(await page.$('.echo-card')) && (await text()).includes('another day'));
  await setting('echoFrequency', 'off');
  await go('/echoes');
  check('echoes turned off is explained, with a way back', (await text()).includes('echoes are turned off') && (await text()).includes('turn echoes back on'));
  await setting('echoFrequency', 'daily');
  await unsetting('echoToday');
  await idbRun(async (idb, id, wrap) => wrap(idb.transaction('voicemails', 'readwrite').objectStore('voicemails').delete(id)), oldId);

  // state kept after closing and reopening
  await go('/library?tab=collections');
  check('collections survive reopening the app', (await text()).includes('late night thoughts'));
  await go('/you');
  check('settings survive reopening the app', (await text()).includes('backup'));

  // the restore sheet on the smallest phone
  await page.setViewport({ width: 320, height: 640, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await go('/you');
  await (await page.$('input[type="file"]'))!.uploadFile(`${dl}/${zips[0]}`);
  await page.waitForSelector('.restore-list', { timeout: 15_000 });
  const sheetFit = await page.evaluate(() => {
    const sheet = document.querySelector('.sheet') as HTMLElement;
    const r = sheet.getBoundingClientRect();
    const wide = [...sheet.querySelectorAll<HTMLElement>('*')].filter((e) => e.getBoundingClientRect().right > document.documentElement.clientWidth + 1).length;
    return { wide, sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth, scrolls: sheet.scrollHeight >= sheet.clientHeight, right: Math.round(r.right) };
  });
  check('320px restore preview: nothing spills sideways', sheetFit.wide === 0 && sheetFit.sideways <= 0, JSON.stringify(sheetFit));
  await page.keyboard.press('Escape');
  await page.setViewport({ width: vw, height: vh, deviceScaleFactor: vw > 800 ? 1 : 2 });
  await go('/');

  // ---- the smallest phones: nothing sideways, everything tappable
  await page.setViewport({ width: 320, height: 640, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  for (const path of ['/', '/library', '/library?tab=collections', '/echoes', '/you', '/record', `/voicemail/${target.id}`, `/voicemail/${target.id}/customize`]) {
    await go(path);
    const m = await page.evaluate(() => {
      const small: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>('button, a[href], select, [role=tab], [role=radio]')) {
        if (el.closest('.sr-only') || (el.tagName === 'A' && getComputedStyle(el).display === 'inline' && el.closest('p'))) continue;
        el.scrollIntoView({ block: 'center', inline: 'center' });
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        const reach = (dx: number, dy: number) => {
          let n = 0;
          for (let i = 1; i <= 16; i++) {
            const t = document.elementFromPoint(r.left + r.width / 2 + dx * (r.width / 2 + i), r.top + r.height / 2 + dy * (r.height / 2 + i));
            if (t && (t === el || el.contains(t))) n = i;
            else break;
          }
          return n;
        };
        const w = r.width + reach(-1, 0) + reach(1, 0);
        const h = r.height + reach(0, -1) + reach(0, 1);
        if (w < 42.5 || h < 42.5) small.push(`${el.className || el.tagName} ${Math.round(w)}x${Math.round(h)}`);
      }
      window.scrollTo(0, 0);
      const vwNow = document.documentElement.clientWidth;
      const wide: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>('main *')) {
        const r = el.getBoundingClientRect();
        if (r.width && r.right > vwNow + 1 && !el.closest('.shelf')) wide.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} right=${Math.round(r.right)}`);
      }
      return { sideways: document.documentElement.scrollWidth - vwNow, small, wide: wide.slice(0, 4) };
    });
    check(`320px ${path.split('/')[1] || 'home'}${path.includes('customize') ? ' (edit)' : ''}: no sideways scroll`, m.sideways <= 0, `${m.sideways}px ${m.wide.join('; ')}`);
    check(`320px ${path.split('/')[1] || 'home'}${path.includes('customize') ? ' (edit)' : ''}: everything tappable is at least 44px`, m.small.length === 0, m.small.slice(0, 3).join('; '));
  }
  await page.setViewport({ width: vw, height: vh, deviceScaleFactor: vw > 800 ? 1 : 2 });
  await go('/');

  // ---------------------------------------------------------------- long recording (optional)
  if (LONG_MINUTES > 0) {
    await page.goto(`${BASE}/record?start=1`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.rec-badge', { timeout: 8000 });
    const startedAt = Date.now();
    while (Date.now() - startedAt < LONG_MINUTES * 60_000) await sleep(15_000);
    await clickText('finish', '.ctrl');
    await page.waitForFunction(() => document.body.innerText.includes('you got it out.'), { timeout: 20_000 });
    await clickText('keep it');
    await page.waitForSelector('.player-card');
    const longVm = await dbQuery((v) => v.sort((a, b) => b.durationMs - a.durationMs)[0]);
    const chunkCount = await dbQuery((v, c) => c.filter((x) => x.voicemailId === v.sort((a, b) => b.durationMs - a.durationMs)[0].id).length);
    check(
      `long recording (${LONG_MINUTES} min) kept in full`,
      longVm.durationMs >= LONG_MINUTES * 60_000 - 3000,
      `${(longVm.durationMs / 60000).toFixed(2)} min in ${chunkCount} chunks`,
    );
    await tap('[aria-label="forward 10 seconds"]');
    await page.evaluate(() =>
      document.querySelector('.waveform')!.dispatchEvent(new PointerEvent('pointerdown', { clientX: window.innerWidth * 0.8, bubbles: true })),
    );
    await tap('.play-btn.play-lg');
    await sleep(2000);
    const at = await page.$eval('.player-times span', (e) => e.textContent);
    const atSec = at
      .split(':')
      .map(Number)
      .reduce((a, p) => a * 60 + p, 0);
    check('long recording seeks & plays near the end', atSec >= LONG_MINUTES * 60 * 0.6, `at ${at}`);
  }

  check('no uncaught page errors', errors.length === 0, errors.join(' | '));
} catch (err) {
  await shot('zz-failure').catch(() => {});
  console.error('\n' + (err as Error).message);
  if (errors.length) console.error('page errors:', errors);
  process.exitCode = 1;
} finally {
  writeFileSync(`${OUT}/results.txt`, results.join('\n') + '\n');
  console.log(`\n${passed} checks passed`);
  await browser.close();
  server.kill();
  process.exit(process.exitCode ?? 0);
}
