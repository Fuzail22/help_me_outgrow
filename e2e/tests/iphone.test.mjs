// R5 iPhone browser tests.
// EMULATED, NOT A REAL DEVICE: Chromium with an iPhone viewport, touch and an iOS Safari user-agent. "Home Screen
// app" means navigator.standalone and display-mode: standalone are switched on by an init script. Push goes through
// the local push-service stand-in (see browser.mjs). What only a real iPhone can show is in docs/iphone-test.md.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from '../pw.mjs';
import { startStack, APP } from '../stack.mjs';
import { wirePush, shownNotifications, tapNotification } from '../browser.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const shots = join(here, '..', 'test-results');
// Playwright's iPhone 14 profile (viewport, pixel ratio, touch, mobile mode) with an iOS user-agent of the version under test.
const { userAgent: _ua, defaultBrowserType: _b, ...IPHONE } = devices['iPhone 14'];
const UA = (v) => `Mozilla/5.0 (iPhone; CPU iPhone OS ${v.replace('.', '_')} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${v} Mobile/15E148 Safari/604.1`;
let stack, browser;
// channel 'chromium' (the full browser in headless mode): the headless shell cannot grant notification permission.
before(async () => { stack = await startStack(); browser = await chromium.launch({ channel: 'chromium', headless: true }); });
after(async () => { await browser?.close(); await stack?.stop(); });
const poll = async (fn, ms = 5000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return v; await new Promise((r) => setTimeout(r, 100)); } };

/** An emulated iPhone. `homeScreen: true` makes the page believe it was opened from the Home Screen icon. */
async function iphone({ ios = '17.5', homeScreen = false, grant = homeScreen, storageState } = {}) {
  const context = await browser.newContext({ ...IPHONE, userAgent: UA(ios), timezoneId: 'Asia/Kolkata', locale: 'en-IN', ...(storageState ? { storageState } : {}) });
  if (homeScreen) {
    await context.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'standalone', { get: () => true, configurable: true });
      const original = window.matchMedia.bind(window);
      window.matchMedia = (q) => (/display-mode:\s*standalone/.test(q)
        ? { matches: true, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }
        : original(q));
    });
  }
  const page = await context.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  const push = grant ? await wirePush(context, page, stack) : null;
  return { context, page, push, errors };
}
async function chooseNotes(page, topic = /Burnt out/) {
  await page.goto(`${APP}/start`);
  await page.getByRole('button', { name: topic }).click();
  await page.getByLabel('Time 1').fill('07:00');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('radio', { name: '1 month' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
}

test('in Safari, before sign-in, an iPhone visitor sees the Add to Home Screen guide instead of sign-in (emulated iPhone)', async () => {
  const v = await iphone({ ios: '17.5' });
  await v.page.goto(APP);
  const guide = v.page.getByRole('note', { name: 'Add to Home Screen' });
  await guide.waitFor();
  assert.match(await guide.innerText(), /Share[\s\S]*Add to Home Screen[\s\S]*new icon/);
  await chooseNotes(v.page);
  await v.page.getByRole('heading', { name: 'One step before you sign in' }).waitFor();
  await v.page.getByRole('note', { name: 'Add to Home Screen' }).waitFor();
  assert.equal(await v.page.getByRole('checkbox').count(), 0, 'no consent box where nothing can be saved');
  assert.equal(await v.page.getByRole('button', { name: 'Continue as demo user' }).count(), 0, 'no sign-in in Safari on iPhone');
  await v.page.screenshot({ path: join(shots, 'iphone-safari-guide.png'), fullPage: true });
  const before = (await stack.stats()).lifecycle.ios_interest;
  await v.page.getByRole('button', { name: 'I will add it now' }).click();
  await v.page.getByText('Thanks, noted.').waitFor();
  assert.ok(await poll(async () => (await stack.stats()).lifecycle.ios_interest === before + 1), 'interest is counted');
  // The sign-in page of My notes shows the guide too.
  await v.page.goto(`${APP}/manage`);
  await v.page.getByRole('note', { name: 'Add to Home Screen' }).waitFor();
  assert.deepEqual(v.errors, []);
  await v.context.close();
});

test('on iOS older than 16.4 the visitor is told to update (emulated iPhone, iOS 16.3)', async () => {
  const v = await iphone({ ios: '16.3' });
  await v.page.goto(APP);
  const note = v.page.getByRole('note', { name: 'Update your iPhone' });
  await note.waitFor();
  assert.match(await note.innerText(), /iOS 16\.3[\s\S]*from iOS 16\.4[\s\S]*Software Update/);
  assert.equal(await v.page.getByRole('note', { name: 'Add to Home Screen' }).count(), 0);
  for (const ios of ['16.4', '18.1']) {
    const ok = await iphone({ ios }); await ok.page.goto(APP);
    await ok.page.getByRole('note', { name: 'Add to Home Screen' }).waitFor();
    assert.equal(await ok.page.getByRole('note', { name: 'Update your iPhone' }).count(), 0, `iOS ${ios} is new enough`);
    await ok.context.close();
  }
  await v.context.close();
});

test('inside the Home Screen app the full flow works: sign in, topic and times, allow, subscribe, receive, rate on the page (emulated iPhone)', async () => {
  const v = await iphone({ homeScreen: true });
  await v.page.goto(APP);
  await v.page.getByRole('link', { name: 'Choose what you need' }).waitFor();
  assert.equal(await v.page.getByRole('note', { name: 'Add to Home Screen' }).count(), 0, 'no guide inside the app');
  await chooseNotes(v.page, /Loss/);
  await v.page.getByRole('checkbox').check();
  await v.page.route('**/auth/dev', (route) => route.continue({ postData: JSON.stringify({ name: 'iPhone app' }) }));
  await v.page.getByRole('button', { name: 'Continue as demo user' }).click(); // stands in for Google sign-in
  const created = v.page.waitForResponse((r) => r.url().endsWith('/api/enrolments') && r.request().method() === 'POST');
  await v.page.getByRole('button', { name: 'Turn on notifications' }).click();
  const enr = await (await created).json();
  await v.page.getByRole('heading', { name: 'You are set.' }).waitFor();
  const me = await v.page.evaluate(() => fetch('/auth/me').then((r) => r.json()));
  assert.equal(me.user.name, 'iPhone app');

  await stack.tick(enr.nextSendAt);
  await v.push.deliverPending(APP);
  const [note] = await poll(async () => { const n = await shownNotifications(v.context); return n.length ? n : null; });
  // Nothing depends on buttons or an image: the line is in the body, and tapping it opens the rating page.
  assert.match(note.body, /Grief has no schedule/);
  const url = await tapNotification(v.context, note.tag);
  const q = await (await browser.newContext({ ...IPHONE, userAgent: UA('17.5') })).newPage();
  await q.goto(url); await q.locator('blockquote').waitFor();
  const before = (await stack.stats()).ratings.up;
  await q.getByRole('button', { name: 'Helpful' }).click();
  await q.getByText('You can close this tab.').waitFor();
  assert.ok(await poll(async () => (await stack.stats()).ratings.up === before + 1));
  await q.screenshot({ path: join(shots, 'iphone-quote-rating.png') });
  assert.deepEqual(v.errors, []);
  await q.context().close(); await v.context.close();
});

test('the Home Screen app reconnects silently when its subscription is lost; with permission gone it shows one banner (emulated iPhone)', async () => {
  const v = await iphone({ homeScreen: true });
  await chooseNotes(v.page, /After a break-up/);
  await v.page.getByRole('checkbox').check();
  await v.page.getByRole('button', { name: 'Continue as demo user' }).click();
  await v.page.getByRole('button', { name: 'Turn on notifications' }).click();
  await v.page.getByRole('heading', { name: 'You are set.' }).waitFor();

  // Lost subscription, permission still granted: re-subscribed on the next open, nothing shown.
  const activeBefore = (await stack.stats()).totals.devicesActive;
  await v.page.evaluate(() => localStorage.removeItem('__fakePushSub'));
  await v.page.goto(APP);
  assert.ok(await poll(async () => (await stack.stats()).totals.devicesActive === activeBefore + 1), 'a new subscription was registered');
  await v.page.waitForTimeout(400);
  assert.equal(await v.page.getByRole('status', { name: 'Notifications are off' }).count(), 0);

  // Same person, notification permission not granted on this device: one banner, which can be dismissed.
  const w = await iphone({ homeScreen: true, grant: false, storageState: await v.context.storageState() });
  await w.page.goto(APP);
  const banner = w.page.getByRole('status', { name: 'Notifications are off' });
  await banner.waitFor();
  assert.equal(await banner.count(), 1);
  await w.page.screenshot({ path: join(shots, 'iphone-reconnect-banner.png') });
  await banner.getByRole('button', { name: 'Dismiss' }).click();
  await w.page.goto(`${APP}/privacy`); await w.page.waitForTimeout(600);
  assert.equal(await w.page.getByRole('status', { name: 'Notifications are off' }).count(), 0, 'dismissed for the session');
  await w.context.close(); await v.context.close();
});

test('"Stop notes on this device" is never undone by the silent reconnect, even with permission still granted (emulated iPhone)', async () => {
  const v = await iphone({ homeScreen: true });
  await chooseNotes(v.page, /Loss/);
  await v.page.getByRole('checkbox').check();
  // Each test is its own person: one person's topics must be 15 minutes apart (platform policy).
  await v.page.route('**/auth/dev', (route) => route.continue({ postData: JSON.stringify({ name: 'iPhone stop' }) }));
  await v.page.getByRole('button', { name: 'Continue as demo user' }).click();
  await v.page.getByRole('button', { name: 'Turn on notifications' }).click();
  await v.page.getByRole('heading', { name: 'You are set.' }).waitFor();
  await v.page.goto(`${APP}/manage`);
  await v.page.getByRole('button', { name: 'Stop notes on this device' }).click();
  await v.page.getByText('This device will no longer receive notes.').waitFor();
  const activeAfterStop = (await stack.stats()).totals.devicesActive;
  // Reopen the app twice: notes still scheduled, permission still granted, but the person said stop.
  for (const path of ['/', '/manage']) { await v.page.goto(APP + path); await v.page.waitForTimeout(1200); }
  assert.equal((await stack.stats()).totals.devicesActive, activeAfterStop, 'no silent re-subscribe after an explicit stop');
  // Turning them back on by hand works, and from then on the silent reconnect applies again.
  await v.page.getByRole('button', { name: /Turn (back )?on/ }).first().click();
  assert.ok(await poll(async () => (await stack.stats()).totals.devicesActive === activeAfterStop + 1), 'turned back on by hand');
  await v.page.evaluate(() => localStorage.removeItem('__fakePushSub'));
  await v.page.goto(APP);
  assert.ok(await poll(async () => (await stack.stats()).totals.devicesActive === activeAfterStop + 2), 'silent reconnect applies again');
  await v.context.close();
});

test('image content appears only on the quote page; the notification does not depend on it (emulated iPhone)', async () => {
  const v = await iphone({ homeScreen: true });
  await chooseNotes(v.page, /Low mood/);
  await v.page.getByRole('checkbox').check();
  await v.page.route('**/auth/dev', (route) => route.continue({ postData: JSON.stringify({ name: 'iPhone image' }) }));
  await v.page.getByRole('button', { name: 'Continue as demo user' }).click();
  const created = v.page.waitForResponse((r) => r.url().endsWith('/api/enrolments') && r.request().method() === 'POST');
  await v.page.getByRole('button', { name: 'Turn on notifications' }).click();
  const enr = await (await created).json();
  await stack.tick(enr.nextSendAt);
  const [msg] = await v.push.deliverPending(APP);
  const payload = JSON.parse(msg.payload);
  assert.ok(payload.title && payload.body && payload.url, 'the note reads and opens without an image or buttons');
  // A line with an image (0.8 content; the platform already returns imageUrl on the delivery view).
  await v.page.route(/\/v1\/deliveries\/[^/?]+/, async (route) => {
    const res = await route.fetch(); const body = await res.json();
    await route.fulfill({ response: res, json: { ...body, imageUrl: `${APP}/icons/512.png` } });
  });
  await v.page.goto(payload.url);
  const img = v.page.locator('img.quote-image');
  await img.waitFor();
  assert.equal(await img.getAttribute('src'), `${APP}/icons/512.png`);
  await v.context.close();
});

test('the web app manifest and head tags give iOS what it needs (checked against the code and the served page)', async () => {
  const manifest = JSON.parse(readFileSync(join(here, '..', '..', 'client', 'public', 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, '/');
  assert.ok(manifest.icons.some((i) => i.sizes === '180x180' && i.type === 'image/png'));
  const res = await fetch(APP); const html = await res.text();
  assert.match(html, /<link rel="apple-touch-icon" sizes="180x180" href="\/icons\/180\.png"/);
  assert.match(html, /<meta name="apple-mobile-web-app-capable" content="yes"/);
  assert.match(html, /<meta name="apple-mobile-web-app-title" content="outgrow"/);
  const icon = await fetch(`${APP}/icons/180.png`);
  assert.equal(icon.status, 200);
  const png = Buffer.from(await icon.arrayBuffer());
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [180, 180], 'the touch icon is 180 × 180');
});
