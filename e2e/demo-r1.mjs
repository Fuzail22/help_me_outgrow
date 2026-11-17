/**
 * R1 demo: rating from the notification without opening a page.
 *   npm run demo:r1        (needs Xvfb, ffmpeg and python-xlib)
 *
 * A real, headed Chromium runs on a virtual display and the display itself is recorded, so the
 * notification toast and its buttons are the browser's own and are clicked with the X pointer.
 * Stand-ins, said in the captions: the dev login (not Google) and the local push service (see browser.mjs).
 */
import { spawn, execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from './pw.mjs';
import { startStack, APP } from './stack.mjs';
import { wirePush, shownNotifications } from './browser.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(process.env.DEMO_OUT ?? join(here, 'demo-output'));
mkdirSync(out, { recursive: true });
const W = 1280, H = 800;
// Where Chromium's Linux toast puts its action buttons at this window size (measured on Xvfb).
const TOAST = { helpful: [964, 763], notForMe: [1078, 763], body: [1050, 670] };
const stack = await startStack();
const browser = await chromium.launch({ headless: false, args: [`--window-size=${W},${H}`, '--window-position=0,0'] });
const context = await browser.newContext({ viewport: null, timezoneId: 'Asia/Kolkata', locale: 'en-IN' });
const page = await context.newPage();
const push = await wirePush(context, page, stack);
await page.goto(APP);
await page.waitForTimeout(800);

const raw = join(out, 'r1-raw.mp4');
const rec = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'x11grab', '-draw_mouse', '1', '-framerate', '25', '-video_size', `${W}x${H}`, '-i', process.env.DISPLAY,
  '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', raw], { stdio: ['pipe', 'ignore', 'inherit'] });
await new Promise((r) => setTimeout(r, 1200));
const t0 = Date.now();
const captions = [];
const say = (text) => { const now = (Date.now() - t0) / 1000; if (captions.length) captions.at(-1).end = now; captions.push({ start: now, end: null, text }); };
const pause = (ms) => page.waitForTimeout(ms);
const click = (x, y) => execFileSync('python3', [join(here, 'xclick.py'), String(x), String(y)]);
const statsCard = async (p, title, s) => p.setContent(`<body style="margin:0;background:#17181c;color:#e8e6e1;font:20px/1.6 system-ui">
  <div style="padding:60px 80px"><h2 style="margin:0 0 20px;font-weight:600">${title}</h2>
  <table style="font:22px/1.8 ui-monospace,monospace;border-collapse:collapse">
  ${[['shown', s.delivery.shown], ['clicked (opens)', s.delivery.clicked], ['rated deliveries', s.delivery.rated], ['ratings up', s.ratings.up], ['ratings down', s.ratings.down]]
    .map(([k, v]) => `<tr><td style="padding-right:48px;color:#a09da8">${k}</td><td>${v}</td></tr>`).join('')}</table></div></body>`);

try {
  say('R1: rate a note from the notification itself. Setting up: one topic, 07:00 daily (demo login, local push service).');
  await page.getByRole('link', { name: 'Choose what you need' }).click(); await pause(900);
  await page.getByRole('button', { name: /Burnt out/ }).click(); await pause(600);
  await page.getByLabel('Time 1', { exact: true }).fill('07:00'); await pause(600);
  await page.getByRole('button', { name: 'Continue' }).click(); await pause(600);
  await page.getByRole('radio', { name: '1 month' }).click(); await pause(500);
  await page.getByRole('button', { name: 'Continue' }).click(); await pause(600);
  await page.getByRole('checkbox').check(); await pause(400);
  await page.getByRole('button', { name: 'Continue as demo user' }).click(); await pause(900);
  const created = page.waitForResponse((r) => r.url().endsWith('/v1/subscribers/me/enrolments') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Turn on notifications' }).click();
  const enr = await (await created).json();
  await page.getByRole('heading', { name: 'You are set.' }).waitFor(); await pause(1500);

  say('07:00 arrives: the platform sends the note. The browser shows it with two buttons: Helpful and Not for me.');
  await stack.tick(enr.nextSendAt); await push.deliverPending(APP);
  await pause(5000);
  say('Tapping "Not for me" on the notification. Watch the tab bar: nothing opens.');
  await pause(2500);
  const tabs = context.pages().length;
  click(...TOAST.notForMe);
  await pause(600);
  say('The note is replaced by "Thanks, noted" (no buttons). The worker closes it after about 3 seconds.');
  await pause(5500);
  if (context.pages().length !== tabs) throw new Error('a tab opened after a rating');
  if ((await shownNotifications(context)).length) throw new Error('the Thanks notification did not close');
  const s1 = await stack.stats();
  if (s1.ratings.down !== 1 || s1.delivery.clicked !== 0) throw new Error(`unexpected stats ${JSON.stringify(s1.ratings)} clicked=${s1.delivery.clicked}`);
  say('Platform stats: the rating is counted from the new "rated" event; it is not counted as an open.');
  await statsCard(page, 'After the button tap (GET /v1/stats)', s1); await pause(6000);

  say('Next day: tapping the body of the note (not a button) still opens the quote page and counts an open.');
  await page.goto(APP); await pause(500);
  await stack.tick(new Date(new Date(enr.nextSendAt).getTime() + 86400000).toISOString()); await push.deliverPending(APP);
  await pause(3500);
  const opened = context.waitForEvent('page', { timeout: 6000 }).catch(() => null);
  const navigated = page.waitForURL(/\/n\//, { timeout: 6000 }).then(() => page).catch(() => null);
  click(...TOAST.body);
  const quote = (await Promise.race([opened, navigated])) ?? page;
  if (!/\/n\//.test(quote.url())) throw new Error('the body tap did not open the quote page');
  await quote.locator('blockquote').waitFor(); await pause(2500);
  say('Where notifications have no buttons (iPhone, Firefox, desktop Safari) this page is the rating screen: the pair comes first.');
  await pause(4500);
  await quote.getByRole('button', { name: 'Helpful' }).hover(); await pause(800);
  await quote.getByRole('button', { name: 'Helpful' }).click();
  await quote.getByText('You can close this tab.').waitFor();
  say('One tap: "Noted. You can close this tab." An optional comment box follows.');
  await pause(5000);
  const s2 = await stack.stats();
  say('Totals now: one open (the body tap), two rated deliveries, one up and one down.');
  await statsCard(quote, 'After the body tap and the page rating (GET /v1/stats)', s2); await pause(6000);
  captions.at(-1).end = (Date.now() - t0) / 1000;
  writeFileSync(join(out, 'r1-stats.json'), JSON.stringify({ afterButton: s1.delivery, afterPage: s2.delivery, ratings: s2.ratings }, null, 2));
} finally {
  rec.stdin.write('q'); await new Promise((r) => rec.on('close', r));
  await browser.close(); await stack.stop();
}

const esc = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, '\u2019').replace(/:/g, '\\:').replace(/,/g, '\\,').replace(/%/g, '\\%');
const font = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
const lead = 1.2 - 0.15;
const draw = captions.map((c) => `drawtext=fontfile=${font}:text='${esc(c.text)}':fontcolor=white:fontsize=20:x=(w-text_w)/2:y=${H}+24:enable='between(t,${(c.start + lead).toFixed(2)},${(c.end + lead).toFixed(2)})'`);
const filter = [`pad=${W}:${H + 68}:0:0:color=0x1d2b2a`, ...draw].join(',');
writeFileSync(join(out, 'r1-captions.json'), JSON.stringify(captions, null, 2));
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-vf', filter, '-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(out, 'r1-feedback-demo.mp4')]);
console.log('wrote', join(out, 'r1-feedback-demo.mp4'));
