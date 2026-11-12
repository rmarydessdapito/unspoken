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
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
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
  check('future me seal is explained', (await text()).includes('sealed until'));
  await clickText('keep it');
  await page.waitForFunction(() => location.pathname === '/library');
  await sleep(400);
  check('sealed voicemail shows locked in library', (await text()).includes('for future me'));
  const sealed = await dbQuery((v) => v.find((x) => x.title === 'i hope future me is okay.'));
  await page.goto(`${BASE}/voicemail/${sealed.id}`, { waitUntil: 'networkidle0' });
  check('sealed voicemail cannot be opened early', (await text()).includes("this one's sealed."));
  await shot('11-sealed');

  // ---------------------------------------------------------------- you / settings
  await page.goto(`${BASE}/you`, { waitUntil: 'networkidle0' });
  await sleep(800);
  check('settings show storage usage', (await text()).includes('of voice'));
  await shot('12-you');

  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await sleep(600);
  await shot('13-home');

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
