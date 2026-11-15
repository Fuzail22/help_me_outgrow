/**
 * Records a walkthrough of the first cut as a video.
 *   npm run demo        (needs Xvfb, ffmpeg and python-xlib)
 *
 * A real, headed Chromium runs on a virtual display and the display itself is
 * recorded, so the notification toast in the video is the browser's own.
 * Two things are stood in for, and the captions say so: Google sign-in (the
 * dev login is used) and the vendor push service (see e2e/browser.mjs).
 */
import { spawn, execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from './pw.mjs';
import { startStack, APP, PLATFORM } from './stack.mjs';
import { wirePush } from './browser.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(process.env.DEMO_OUT ?? join(here, 'demo-output'));
mkdirSync(out, { recursive: true });
const W = 1280, H = 800;
const stack = await startStack();
const browser = await chromium.launch({ headless: false, args: [`--window-size=${W},${H}`, '--window-position=0,0'] });
const context = await browser.newContext({ viewport: null, timezoneId: 'Asia/Kolkata', locale: 'en-IN' });
const page = await context.newPage();
const push = await wirePush(context, page, stack);
await page.goto(APP);
await page.waitForTimeout(800);

const raw = join(out, 'raw.mp4');
const rec = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'x11grab', '-draw_mouse', '1', '-framerate', '25', '-video_size', `${W}x${H}`, '-i', process.env.DISPLAY,
  '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', raw], { stdio: ['pipe', 'ignore', 'inherit'] });
await new Promise((r) => setTimeout(r, 1200));
const t0 = Date.now();
const captions = [];
const say = (text) => { const now = (Date.now() - t0) / 1000; if (captions.length) captions.at(-1).end = now; captions.push({ start: now, end: null, text }); };
const pause = (ms) => page.waitForTimeout(ms);

try {
  say('help me outgrow: the landing page. No app to install.');
  await pause(4000);
  say('Step 1 of 5: choose what you are going through. Four curated topics, 92 lines each.');
  await page.getByRole('link', { name: 'Choose what you need' }).click(); await pause(3000);
  await page.getByRole('button', { name: /Burnt out/ }).click(); await pause(1200);
  say('Step 2: choose days and up to three times a day.');
  await page.getByLabel('Time 1', { exact: true }).fill('07:00'); await pause(1200);
  await page.getByRole('button', { name: '+ Add another time' }).click(); await pause(600);
  await page.getByLabel('Time 2', { exact: true }).fill('21:30'); await pause(1800);
  await page.getByRole('button', { name: 'Continue' }).click();
  say('Step 3: how long (up to 92 days) and a timezone check. Times follow local time, including daylight saving.');
  await pause(1500); await page.getByRole('radio', { name: '3 months' }).click(); await pause(3000);
  await page.getByRole('button', { name: 'Continue' }).click();
  say('Step 4: consent, then sign in. Production uses Google sign-in; this recording uses the local demo login.');
  await pause(2000); await page.getByRole('checkbox').check(); await pause(1500);
  await page.getByRole('button', { name: 'Continue as demo user' }).click();
  say('Step 5: the permission prompt is asked only now, after the person has made their choices.');
  await pause(3000);
  const created = page.waitForResponse((r) => r.url().endsWith('/v1/subscribers/me/enrolments') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Turn on notifications' }).click();
  const enr = await (await created).json();
  await page.getByRole('heading', { name: 'You are set.' }).waitFor();
  say('Enrolled. The platform stored the device and computed the first send time in UTC.');
  await pause(4000);

  say('Fast-forward: the scheduler tick reaches 07:00 local time and the platform sends the push.');
  await pause(2500);
  await stack.tick(enr.nextSendAt);
  await push.deliverPending(APP);
  say("The browser's own notification, shown by the service worker: topic as title, the line, two rating actions.");
  await pause(5000);
  say('Tapping it opens the quote page. The click is reported to the platform.');
  const opened = context.waitForEvent('page', { timeout: 6000 }).catch(() => null);
  const navigated = page.waitForURL(/\/n\//, { timeout: 6000 }).then(() => page).catch(() => null);
  execFileSync('python3', [join(here, 'xclick.py'), String(W - 230), String(H - 110)]);
  const quote = (await Promise.race([opened, navigated])) ?? page;
  if (!/\/n\//.test(quote.url())) throw new Error('the notification click did not open the quote page');
  await quote.locator('blockquote').waitFor(); await pause(3500);
  say('One-tap rating and an optional comment. Every quote page carries the not-a-substitute-for-care line.');
  await quote.getByRole('button', { name: 'Helpful' }).click(); await pause(1500);
  await quote.getByLabel(/What made it land/).pressSequentially('It named exactly how I feel.', { delay: 45 }); await pause(600);
  await quote.getByRole('button', { name: 'Send' }).click(); await pause(2500);
  await quote.mouse.wheel(0, 500); await pause(2500);

  say('My notes: pause, resume, change times, stop, turn a device off, erase all data.');
  await quote.goto(`${APP}/manage`); await quote.locator('.enrolment').first().waitFor(); await pause(3500);
  const card = quote.locator('.enrolment').first();
  await card.getByRole('button', { name: 'Pause' }).click(); await pause(2000);
  await card.getByRole('button', { name: 'Resume' }).click(); await pause(1800);
  await card.getByRole('button', { name: 'Change times' }).click(); await pause(1200);
  await card.getByRole('button', { name: 'Sat' }).click(); await card.getByRole('button', { name: 'Sun' }).click(); await pause(1200);
  await card.getByRole('button', { name: 'Save times' }).click(); await pause(3000);

  say('The operator side: the stats script reads the funnel and health numbers from the platform.');
  const tsx = join(resolve(process.env.NS_REPO ?? join(here, '..', '..', 'notification-service')), 'server', 'node_modules', '.bin', 'tsx');
  const stats = execFileSync(tsx, ['scripts/stats.ts', '--api', PLATFORM, '--key', stack.tenant.secretKey], { cwd: dirname(dirname(dirname(tsx))) }).toString();
  await quote.setContent(`<body style="margin:0;background:#17181c;color:#e8e6e1"><pre style="font:15px/1.5 ui-monospace,monospace;padding:28px 40px;margin:0">$ npm run stats -- --api … --key sk_…\n\n${stats.replace(/</g, '&lt;')}</pre></body>`);
  await pause(7000);
  captions.at(-1).end = (Date.now() - t0) / 1000;
} finally {
  rec.stdin.write('q'); await new Promise((r) => rec.on('close', r));
  await browser.close(); await stack.stop();
}

// Burn the captions in as a bar under the picture.
const esc = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, '\u2019').replace(/:/g, '\\:').replace(/,/g, '\\,').replace(/%/g, '\\%');
const font = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
const lead = 1.2 - 0.15; // recording started this long before t0
const draw = captions.map((c) => `drawtext=fontfile=${font}:text='${esc(c.text)}':fontcolor=white:fontsize=22:x=(w-text_w)/2:y=${H}+22:enable='between(t,${(c.start + lead).toFixed(2)},${(c.end + lead).toFixed(2)})'`);
const filter = [`pad=${W}:${H + 68}:0:0:color=0x1d2b2a`, ...draw].join(',');
writeFileSync(join(out, 'captions.json'), JSON.stringify(captions, null, 2));
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-vf', filter, '-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(out, 'first-cut-demo.mp4')]);
console.log('wrote', join(out, 'first-cut-demo.mp4'));
