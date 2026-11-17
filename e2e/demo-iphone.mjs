/**
 * R5 demo: iPhone support, on an EMULATED iPhone (Chromium with the iPhone 14 profile and an iOS user-agent; the
 * Home Screen app is simulated). The captions say so. Real-device checks are in docs/iphone-test.md.
 *   npm run demo:iphone      (needs Xvfb, ffmpeg and python-xlib)
 */
import { spawn, execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from './pw.mjs';
import { startStack, APP } from './stack.mjs';
import { wirePush } from './browser.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(process.env.DEMO_OUT ?? join(here, 'demo-output'));
mkdirSync(out, { recursive: true });
const W = 1280, H = 800;
const { userAgent: _ua, defaultBrowserType: _b, ...IPHONE } = devices['iPhone 14'];
const UA = (v) => `Mozilla/5.0 (iPhone; CPU iPhone OS ${v.replace('.', '_')} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${v} Mobile/15E148 Safari/604.1`;
const stack = await startStack();
const browser = await chromium.launch({ headless: false, args: [`--window-size=${W},${H}`, '--window-position=0,0'] });
const homeScreen = () => {
  Object.defineProperty(Navigator.prototype, 'standalone', { get: () => true, configurable: true });
  const original = window.matchMedia.bind(window);
  window.matchMedia = (q) => (/display-mode:\s*standalone/.test(q) ? { matches: true, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false } : original(q));
};
const phone = async ({ ios = '17.5', home = false, push = false, storageState } = {}) => {
  const context = await browser.newContext({ ...IPHONE, userAgent: UA(ios), timezoneId: 'Asia/Kolkata', locale: 'en-IN', ...(storageState ? { storageState } : {}) });
  if (home) await context.addInitScript(homeScreen);
  const page = await context.newPage();
  return { context, page, push: push ? await wirePush(context, page, stack) : null };
};
const label = (page, text) => page.evaluate((t) => {
  document.getElementById('demolabel')?.remove();
  const b = document.createElement('div'); b.id = 'demolabel'; b.textContent = t;
  b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99;background:#1d2b2a;color:#fff;font:600 12px system-ui;padding:4px 8px;text-align:center;opacity:.92';
  document.body.append(b);
}, text);

const raw = join(out, 'r5-raw.mp4');
let s = await phone(); await s.page.goto(APP); await s.page.waitForTimeout(800);
const rec = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'x11grab', '-draw_mouse', '1', '-framerate', '25', '-video_size', `${W}x${H}`, '-i', process.env.DISPLAY,
  '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', raw], { stdio: ['pipe', 'ignore', 'inherit'] });
await new Promise((r) => setTimeout(r, 1200));
const t0 = Date.now(); const captions = [];
const say = (text) => { const now = (Date.now() - t0) / 1000; if (captions.length) captions.at(-1).end = now; captions.push({ start: now, end: null, text }); };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const expect = (c, what) => { if (!c) throw new Error(`demo check failed: ${what}`); };
const click = (x, y) => execFileSync('python3', [join(here, 'xclick.py'), String(x), String(y)]);
try {
  say('R5 iPhone support, on an EMULATED iPhone (Chromium, iPhone 14 profile, iOS 17.5 user-agent). Not a real device.');
  await label(s.page, 'Safari on iPhone (emulated)'); await pause(3500);
  say('In Safari, before sign-in, the landing page shows how to add the app to the Home Screen.');
  await s.page.getByRole('note', { name: 'Add to Home Screen' }).scrollIntoViewIfNeeded(); await pause(4500);
  say('Choosing notes in Safari leads to the same guide instead of sign-in: iOS sends notifications only to Home Screen apps.');
  await s.page.goto(`${APP}/start`); await label(s.page, 'Safari on iPhone (emulated)');
  await s.page.getByRole('button', { name: /Burnt out/ }).click(); await pause(600);
  await s.page.getByLabel('Time 1').fill('07:00'); await s.page.getByRole('button', { name: 'Continue' }).click(); await pause(600);
  await s.page.getByRole('button', { name: 'Continue' }).click();
  await s.page.getByRole('heading', { name: 'One step before you sign in' }).waitFor(); await pause(1200);
  await s.page.getByRole('note', { name: 'Add to Home Screen' }).scrollIntoViewIfNeeded(); await pause(4000);
  await s.context.close();

  s = await phone({ ios: '16.3' }); await s.page.goto(APP); await label(s.page, 'Safari on iPhone, iOS 16.3 (emulated)');
  say('On iOS older than 16.4, which cannot receive web notifications, the visitor is told to update first.');
  await s.page.getByRole('note', { name: 'Update your iPhone' }).scrollIntoViewIfNeeded(); await pause(5000);
  await s.context.close();

  s = await phone({ home: true, push: true }); await s.page.goto(APP); await label(s.page, 'Home Screen app (emulated)');
  say('Opened from the Home Screen (simulated): no guide. Choose a topic and a time, sign in (dev login stands in for Google), allow.');
  await pause(2000);
  await s.page.getByRole('link', { name: 'Choose what you need' }).click(); await label(s.page, 'Home Screen app (emulated)');
  await s.page.getByRole('button', { name: /Loss/ }).click(); await pause(700);
  await s.page.getByLabel('Time 1').fill('07:00'); await pause(500); await s.page.getByRole('button', { name: 'Continue' }).click(); await pause(700);
  await s.page.getByRole('button', { name: 'Continue' }).click(); await pause(700);
  await s.page.getByRole('checkbox').check(); await pause(500);
  await s.page.getByRole('button', { name: 'Continue as demo user' }).click(); await pause(1000);
  const created = s.page.waitForResponse((r) => r.url().endsWith('/v1/subscribers/me/enrolments') && r.request().method() === 'POST');
  await s.page.getByRole('button', { name: 'Turn on notifications' }).click();
  const enr = await (await created).json();
  await s.page.getByRole('heading', { name: 'You are set.' }).waitFor(); await label(s.page, 'Home Screen app (emulated)'); await pause(3000);

  say('07:00: the note arrives. The line is in the text; nothing depends on buttons or images, which iOS does not show.');
  await stack.tick(enr.nextSendAt); await s.push.deliverPending(APP); await pause(5000);
  say('Tapping the note opens the rating page; one tap rates it. (The toast is Chromium’s on Linux, not iOS.)');
  const opened = s.context.waitForEvent('page', { timeout: 6000 }).catch(() => null);
  const nav = s.page.waitForURL(/\/n\//, { timeout: 6000 }).then(() => s.page).catch(() => null);
  click(1050, 670);
  const q = (await Promise.race([opened, nav])) ?? s.page;
  expect(/\/n\//.test(q.url()), 'quote page opened');
  await q.locator('blockquote').waitFor(); await label(q, 'Home Screen app (emulated)'); await pause(2000);
  await q.getByRole('button', { name: 'Helpful' }).click(); await q.getByText('You can close this tab.').waitFor(); await pause(3500);

  if (q !== s.page) await q.close();
  await s.page.bringToFront();
  say('If the subscription is lost while permission is still granted, the app re-subscribes silently on the next open.');
  const before = (await stack.stats()).totals.devicesActive;
  await s.page.evaluate(() => localStorage.removeItem('__fakePushSub'));
  await s.page.goto(APP); await label(s.page, 'Home Screen app (emulated)');
  let after = before; for (let i = 0; i < 50 && after === before; i++) { await pause(100); after = (await stack.stats()).totals.devicesActive; }
  expect(after === before + 1, 'silent reconnect');
  await s.page.evaluate(([b, a]) => {
    const box = document.createElement('pre'); box.style.cssText = 'position:fixed;left:8px;right:8px;bottom:12px;background:#17181c;color:#e8e6e1;padding:10px;border-radius:10px;font:12px/1.5 ui-monospace,monospace;margin:0;z-index:9;white-space:pre-wrap';
    box.textContent = `platform: active devices ${b} → ${a}\nno prompt, no banner`; document.body.append(box);
  }, [before, after]);
  await pause(5500);
  const state = await s.context.storageState(); await s.context.close();

  s = await phone({ home: true, storageState: state }); await s.page.goto(APP);
  await s.page.getByRole('status', { name: 'Notifications are off' }).waitFor(); await label(s.page, 'Home Screen app, notifications not allowed (emulated)');
  say('If notifications are not allowed on the device, the app shows one banner instead. Real-iPhone checks: docs/iphone-test.md.');
  await pause(6000);
  captions.at(-1).end = (Date.now() - t0) / 1000;
} finally {
  rec.stdin.write('q'); await new Promise((r) => rec.on('close', r));
  await browser.close(); await stack.stop();
}
const esc = (x) => x.replace(/\\/g, '\\\\').replace(/'/g, '\u2019').replace(/:/g, '\\:').replace(/,/g, '\\,').replace(/%/g, '\\%');
const font = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
const draw = captions.map((c) => `drawtext=fontfile=${font}:text='${esc(c.text)}':fontcolor=white:fontsize=${Math.min(19, Math.floor((W - 40) / (c.text.length * 0.6)))}:x=(w-text_w)/2:y=${H}+24:enable='between(t,${(c.start + 1.05).toFixed(2)},${(c.end + 1.05).toFixed(2)})'`);
writeFileSync(join(out, 'r5-captions.json'), JSON.stringify(captions, null, 2));
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-vf', [`pad=${W}:${H + 68}:0:0:color=0x1d2b2a`, ...draw].join(','), '-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(out, 'r5-iphone-demo.mp4')]);
console.log('wrote', join(out, 'r5-iphone-demo.mp4'));
