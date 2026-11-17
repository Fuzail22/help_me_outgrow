/**
 * R5 demo: iPhone support, in an EMULATED iPhone.
 *   npm run demo:r5        (needs ffmpeg)
 *
 * Chromium with an iPhone 14 viewport, touch and an iOS Safari user-agent; for the Home Screen app,
 * `navigator.standalone` and the standalone display mode are switched on by script. This is not a real
 * iPhone and not WebKit, and the captions say so. Stand-ins, also said in the captions: the dev login
 * (not Google) and the local push service (see browser.mjs). Each scene is recorded by Playwright and the
 * scenes are joined with their captions beside the phone.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from './pw.mjs';
import { startStack, APP, PLATFORM } from './stack.mjs';
import { wirePush, shownNotifications, tapNotification } from './browser.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(process.env.DEMO_OUT ?? join(here, 'demo-output'));
const work = join(out, 'r5-work'); rmSync(work, { recursive: true, force: true }); mkdirSync(work, { recursive: true });
const PHONE = devices['iPhone 14'].viewport; // the page area (390 × 664), not the whole screen
const iosUA = (v, s) => `Mozilla/5.0 (iPhone; CPU iPhone OS ${v} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${s} Mobile/15E148 Safari/604.1`;

const stack = await startStack();
const browser = await chromium.launch({ channel: 'chromium', headless: true });
const scenes = [];

async function scene(name, { homeScreen = false, ua = iosUA('17_5', '17.5'), push = false, permission } = {}, body) {
  const dir = join(work, name); mkdirSync(dir, { recursive: true });
  const context = await browser.newContext({ ...devices['iPhone 14'], deviceScaleFactor: 1, userAgent: ua, timezoneId: 'Asia/Kolkata', locale: 'en-IN', recordVideo: { dir, size: PHONE } });
  if (homeScreen) await context.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'standalone', { get: () => true, configurable: true });
    const mm = window.matchMedia.bind(window);
    window.matchMedia = (q) => (/display-mode:\s*standalone/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} } : mm(q));
  });
  const page = await context.newPage();
  const t0 = Date.now();
  const captions = [];
  const say = (text) => { const now = (Date.now() - t0) / 1000; if (captions.length) captions.at(-1).end = now; captions.push({ start: now, end: null, text }); };
  const wired = push ? await wirePush(context, page, stack) : null;
  try { await body({ page, context, say, pause: (ms) => page.waitForTimeout(ms), push: wired }); }
  finally {
    captions.at(-1).end = (Date.now() - t0) / 1000;
    const video = page.video();
    await context.close();
    scenes.push({ name, file: await video.path(), captions });
  }
}

/** A card standing in for what cannot be filmed in an emulator (the push itself), said plainly. */
const card = (page, title, rows) => page.setContent(`<meta name=viewport content="width=device-width"><body style="margin:0;background:#17181c;color:#e8e6e1;font:16px/1.5 system-ui">
  <div style="padding:40px 22px"><p style="color:#a09da8;margin:0 0 6px;font-size:13px;text-transform:uppercase;letter-spacing:.08em">${title}</p>
  ${rows.map(([k, v]) => `<div style="margin:14px 0"><div style="color:#a09da8;font-size:13px">${k}</div><div style="font:15px/1.45 ui-monospace,monospace;word-break:break-word">${v}</div></div>`).join('')}</div></body>`);

async function onboard(page, pause, name) {
  await page.getByRole('link', { name: 'Choose what you need' }).tap(); await pause(900);
  await page.getByRole('button', { name: /Burnt out/ }).tap(); await pause(700);
  await page.getByLabel('Time 1').fill('07:00'); await pause(600);
  await page.getByRole('button', { name: 'Continue' }).tap(); await pause(700);
  await page.getByRole('radio', { name: '1 month' }).tap(); await pause(500);
  await page.getByRole('button', { name: 'Continue' }).tap(); await pause(700);
  await page.getByRole('checkbox').tap(); await pause(500);
  await page.route('**/auth/dev', (route) => route.continue({ postData: JSON.stringify({ name }) }));
  await page.getByRole('button', { name: 'Continue as demo user' }).tap(); await pause(1000);
  const created = page.waitForResponse((r) => r.url().endsWith('/v1/subscribers/me/enrolments') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Turn on notifications' }).tap();
  const enr = await (await created).json();
  await page.getByRole('heading', { name: 'You are set.' }).waitFor();
  return enr;
}
const activeDevices = (page) => page.evaluate(async (P) => {
  const { token } = await (await fetch('/auth/platform-token', { method: 'POST' })).json();
  return (await (await fetch(`${P}/v1/subscribers/me`, { headers: { authorization: `Bearer ${token}` } })).json()).devices.filter((d) => d.status === 'active').length;
}, PLATFORM);

try {
  await scene('1-safari', {}, async ({ page, say, pause }) => {
    say('R5 iPhone support. EMULATED iPhone 14 (Chromium with an iOS 17.5 Safari user-agent), not a real phone.');
    await page.goto(APP); await pause(3500);
    say('In a Safari tab, before sign-in, the landing page shows how to add the app to the Home Screen. No way into a flow that cannot work there.');
    await page.getByRole('note', { name: 'Add to Home Screen' }).scrollIntoViewIfNeeded(); await pause(5500);
    say('A link straight to /start shows the same guide instead of the topics. Nothing is saved.');
    await page.goto(`${APP}/start`); await page.getByRole('note', { name: 'Add to Home Screen' }).waitFor(); await pause(4500);
    say('My notes, signed out: the guide sits above sign-in, so existing notes can still be managed from Safari.');
    await page.goto(`${APP}/manage`); await page.getByRole('heading', { name: 'Sign in to see your notes' }).waitFor(); await pause(4500);
  });
  await scene('2-old-ios', { ua: iosUA('16_3', '16.3') }, async ({ page, say, pause }) => {
    say('Emulated iOS 16.3: web push needs iOS 16.4, so the visitor is told to update, with the Settings path.');
    await page.goto(`${APP}/start`); await page.getByRole('note', { name: 'Update iOS' }).waitFor(); await pause(5000);
  });
  await scene('3-home-screen', { homeScreen: true, push: true }, async ({ page, context, say, pause, push }) => {
    say('Now as the Home Screen app (standalone mode switched on by script). No guide; the normal flow.');
    await page.goto(APP); await pause(3500);
    say('Topic, time, duration, consent, sign-in (demo login here; Google in production), then Allow.');
    const enr = await onboard(page, pause, 'iPhone demo');
    say('Subscribed. The platform stored this device as iOS.');
    await pause(4000);
    await stack.tick(enr.nextSendAt);
    const [msg] = await push.deliverPending(APP);
    const p = JSON.parse(msg.payload);
    const [note] = await (async () => { for (let i = 0; i < 50; i++) { const n = await shownNotifications(context); if (n.length) return n; await pause(100); } return []; })();
    say('07:00: the push arrives (local push service stand-in). A real Lock Screen cannot be filmed here. This is the payload: title, text and a tap target are enough; iOS shows no buttons and no image.');
    await card(page, 'Push received by the service worker', [['title', p.title], ['body', p.body], ['tap opens', p.url.replace(APP, '').replace(/t=.*/, 't=…')], ['buttons (ignored on iPhone)', 'Helpful · Not for me']]);
    await pause(8000);
    const url = await tapNotification(context, note.tag);
    say('Tapping the note opens the quote page. The rating pair is the first and largest control.');
    await page.goto(url); await page.locator('blockquote').waitFor(); await pause(4500);
    await page.getByRole('button', { name: 'Helpful' }).tap();
    await page.getByText('You can close this tab.').waitFor();
    say('One tap: "Noted. You can close this tab."');
    await pause(4000);

    say('iOS dropped the subscription (app removed and added again), permission still granted: the app reconnects silently.');
    await page.evaluate(() => localStorage.removeItem('__fakePushSub'));
    await page.goto(`${APP}/manage`); await page.getByRole('heading', { name: 'My notes' }).waitFor();
    for (let i = 0; i < 50 && (await activeDevices(page)) < 2; i++) await pause(100);
    await pause(5000);
    say(`No prompt and no banner: a new subscription was stored (${await activeDevices(page)} active devices on the platform for this person).`);
    await pause(5000);
  });
  await scene('4-banner', { homeScreen: true, push: true }, async ({ page, context, say, pause }) => {
    await page.goto(APP);
    say('If notifications were turned off in iOS Settings (permission no longer granted)…');
    await onboard(page, pause, 'Banner demo');
    await page.evaluate(() => localStorage.removeItem('__fakePushSub'));
    await context.addInitScript(() => { Object.defineProperty(Notification, 'permission', { get: () => 'default', configurable: true }); });
    await page.goto(APP);
    await page.getByRole('alert').filter({ hasText: 'Notifications are off on this device.' }).waitFor();
    say('…the app shows one banner, with a link to turn them back on.');
    await pause(5000);
    await page.getByRole('link', { name: 'Turn them back on' }).tap();
    await page.getByRole('button', { name: 'Turn back on' }).waitFor();
    say('On My notes the fuller notice replaces it: still one. Owner checks on a real iPhone: docs/iphone-test.md.');
    await pause(6000);
  });
} finally {
  await browser.close(); await stack.stop();
}

// Each scene: phone on the left, its captions on the right, then join the scenes.
const W = 1000, H = PHONE.height + 40;
const font = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
const wrap = (s, n = 44) => s.split(' ').reduce((lines, w) => { const l = lines.at(-1); if ((l + ' ' + w).trim().length > n) lines.push(w); else lines[lines.length - 1] = (l + ' ' + w).trim(); return lines; }, ['']).join('\n');
const parts = [];
for (const s of scenes) {
  const draw = s.captions.map((c, i) => {
    const tf = join(work, `${s.name}-${i}.txt`); writeFileSync(tf, wrap(c.text));
    return `drawtext=fontfile=${font}:textfile=${tf}:fontcolor=white:fontsize=22:line_spacing=10:x=${PHONE.width + 80}:y=120:enable='between(t,${c.start.toFixed(2)},${c.end.toFixed(2)})'`;
  });
  const part = join(work, `${s.name}.mp4`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', s.file, '-vf', [`pad=${W}:${H}:40:20:color=0x1d2b2a`, `drawtext=fontfile=${font}:text='EMULATED iPhone (not a real device)':fontcolor=0xf0c987:fontsize=18:x=${PHONE.width + 80}:y=60`, ...draw].join(','),
    '-r', '25', '-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-pix_fmt', 'yuv420p', part]);
  parts.push(part);
}
const list = join(work, 'list.txt'); writeFileSync(list, parts.map((p) => `file '${p}'`).join('\n'));
const final = join(out, 'r5-iphone-demo.mp4');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', final]);
writeFileSync(join(out, 'r5-captions.json'), JSON.stringify(scenes.map((s) => ({ scene: s.name, captions: s.captions })), null, 2));
console.log('wrote', final);
