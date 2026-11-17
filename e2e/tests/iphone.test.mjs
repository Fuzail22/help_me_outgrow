/**
 * R5: iPhone support, tested in an EMULATED iPhone.
 *
 * These run in desktop Chromium with an iPhone viewport, touch and an iOS Safari user-agent, and (for the
 * Home Screen app) with `navigator.standalone` and the standalone display mode switched on by script.
 * This is not a real iPhone and not WebKit: it proves the app's iPhone screens and logic, not that iOS
 * delivers the push. The owner checks that on a real phone with docs/iphone-test.md.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from '../pw.mjs';
import { startStack, APP, PLATFORM } from '../stack.mjs';
import { wirePush, shownNotifications, tapNotification } from '../browser.mjs';

const here = dirname(fileURLToPath(import.meta.url));
let stack, browser;
before(async () => { stack = await startStack(); browser = await chromium.launch({ channel: 'chromium', headless: true }); });
after(async () => { await browser?.close(); await stack?.stop(); });

const poll = async (fn, ms = 5000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return v; await new Promise((r) => setTimeout(r, 100)); } };
const iosUA = (v = '17_5', safari = '17.5') => `Mozilla/5.0 (iPhone; CPU iPhone OS ${v} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${safari} Mobile/15E148 Safari/604.1`;
const IPADOS_DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';

/** An emulated iPhone. `homeScreen: true` makes it behave like the app opened from the Home Screen icon. */
async function iphone({ homeScreen = false, grant = homeScreen, userAgent = iosUA(), device = devices['iPhone 14'], extra = {} } = {}) {
  const context = await browser.newContext({ ...device, userAgent, timezoneId: 'Asia/Kolkata', locale: 'en-IN', ...extra });
  if (homeScreen) {
    await context.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'standalone', { get: () => true, configurable: true });
      const mm = window.matchMedia.bind(window);
      window.matchMedia = (q) => (/display-mode:\s*standalone/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} } : mm(q));
    });
  }
  const page = await context.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  const push = grant ? await wirePush(context, page, stack) : null;
  return { context, page, push, errors };
}

/** The platform's view of the signed-in person, read with the app's own token. */
const platformMe = (page) => page.evaluate(async (P) => {
  const { token } = await (await fetch('/auth/platform-token', { method: 'POST' })).json();
  return (await fetch(`${P}/v1/subscribers/me`, { headers: { authorization: `Bearer ${token}` } })).json();
}, PLATFORM);

async function onboardInApp(page, { name, topic = /break-up/i }) {
  await page.goto(APP);
  await page.getByRole('link', { name: 'Choose what you need' }).click();
  await page.getByRole('button', { name: topic }).click();
  await page.getByLabel('Time 1').fill('07:00');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('radio', { name: '1 month' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('checkbox').check();
  await page.route('**/auth/dev', (route) => route.continue({ postData: JSON.stringify({ name }) }));
  await page.getByRole('button', { name: 'Continue as demo user' }).click();
  const created = page.waitForResponse((r) => r.url().endsWith('/v1/subscribers/me/enrolments') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Turn on notifications' }).click();
  const enrolment = await (await created).json();
  await page.getByRole('heading', { name: 'You are set.' }).waitFor();
  return enrolment;
}

test('R5.1 (emulated): in Safari, before sign-in, an iPhone visitor gets the Add to Home Screen guide and nothing is saved', async () => {
  const v = await iphone();
  const before = (await stack.stats()).lifecycle.unsupported;
  await v.page.goto(APP);
  const guide = v.page.getByRole('note', { name: 'Add to Home Screen' });
  await guide.waitFor();
  assert.match(await guide.innerText(), /Share[\s\S]*Add to Home Screen[\s\S]*Open outgrow from your Home Screen/);
  assert.equal(await v.page.getByRole('link', { name: 'Choose what you need' }).count(), 0, 'no way into a flow that cannot work in Safari');

  // A deep link to the flow shows the same guide instead of the topic picker, and counts it once.
  await v.page.goto(`${APP}/start`);
  await v.page.getByRole('heading', { name: 'Get notes on your iPhone' }).waitFor();
  await v.page.getByRole('note', { name: 'Add to Home Screen' }).waitFor();
  assert.equal(await v.page.getByRole('button', { name: /Burnt out/ }).count(), 0);
  assert.ok(await poll(async () => (await stack.stats()).lifecycle.unsupported === before + 1));

  // My notes, signed out: the guide sits above sign-in (managing existing notes from Safari still works).
  await v.page.goto(`${APP}/manage`);
  await v.page.getByRole('heading', { name: 'Sign in to see your notes' }).waitFor();
  await v.page.getByRole('note', { name: 'Add to Home Screen' }).waitFor();
  await v.page.getByRole('button', { name: 'Continue as demo user' }).waitFor();
  assert.equal(await v.page.evaluate(() => Notification.permission), 'default', 'no permission prompt was raised');
  assert.deepEqual(v.errors, []);
  await v.context.close();
});

test('R5.1 (emulated): iOS older than 16.4 is told to update; 16.4 and iPadOS in desktop mode get the guide', async () => {
  for (const [ua, expect] of [[iosUA('16_3', '16.3'), 'update'], [iosUA('15_8', '15.6'), 'update'], [iosUA('16_4', '16.4'), 'guide'], [IPADOS_DESKTOP_UA, 'guide']]) {
    const ipad = ua === IPADOS_DESKTOP_UA;
    const v = await iphone({ userAgent: ua, ...(ipad ? { device: devices['iPad Pro 11'] } : {}) });
    if (ipad) await v.context.addInitScript(() => { Object.defineProperty(Navigator.prototype, 'platform', { get: () => 'MacIntel' }); Object.defineProperty(Navigator.prototype, 'maxTouchPoints', { get: () => 5 }); });
    await v.page.goto(`${APP}/start`);
    if (expect === 'update') {
      const note = v.page.getByRole('note', { name: 'Update iOS' });
      await note.waitFor();
      assert.match(await note.innerText(), /iOS 16\.4 or later/);
      assert.match(await note.innerText(), /Software Update/);
    } else {
      await v.page.getByRole('note', { name: 'Add to Home Screen' }).waitFor();
    }
    await v.context.close();
  }
});

test('R5.2 + R5.4 (emulated): inside the Home Screen app the whole flow works and the note needs no buttons or image', async () => {
  const v = await iphone({ homeScreen: true });
  await v.page.goto(APP);
  assert.equal(await v.page.getByRole('note', { name: 'Add to Home Screen' }).count(), 0, 'no guide inside the app');
  const enr = await onboardInApp(v.page, { name: 'iPhone app', topic: /Low mood/ });
  assert.equal(enr.status, 'active');
  const me = await platformMe(v.page);
  const device = me.devices.find((d) => d.status === 'active');
  assert.ok(device, 'the subscription was stored on the platform');
  assert.equal(device.platform, 'iOS');

  // A note arrives. Everything a person needs is in the title, body and the tap target, because iOS shows
  // no action buttons and no notification image.
  await stack.tick(enr.nextSendAt);
  const [msg] = await v.push.deliverPending(APP);
  const payload = JSON.parse(msg.payload);
  assert.ok(payload.title && payload.body, 'the note reads on its own');
  assert.ok(payload.url.startsWith(`${APP}/n/`), 'tapping it opens the rating screen');
  const [note] = await poll(async () => { const n = await shownNotifications(v.context); return n.length ? n : null; });

  // Tap the body (the only thing iOS offers), then rate with one tap on the quote page.
  const url = await tapNotification(v.context, note.tag);
  await v.page.goto(url);
  await v.page.locator('blockquote').waitFor();
  const helpful = v.page.getByRole('button', { name: 'Helpful' });
  const box = await helpful.boundingBox();
  assert.ok(box.width >= 120 && box.height >= 90, `the rating control is large on a phone (${box.width}x${box.height})`);
  const before = (await stack.stats()).ratings.up;
  await helpful.tap();
  await v.page.getByText('You can close this tab.').waitFor();
  assert.ok(await poll(async () => (await stack.stats()).ratings.up === before + 1));
  const overflow = await v.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.equal(overflow, 0);
  assert.deepEqual(v.errors, []);
  await v.context.close();
});

test('R5.4: image content appears only on the quote page, never required by the notification', async () => {
  // Give one delivery's line an image through the delivery view, as a 0.8 line with an image would.
  const v = await iphone({ homeScreen: true });
  const enr = await onboardInApp(v.page, { name: 'Image', topic: /Burnt out/ });
  await stack.tick(enr.nextSendAt);
  const [msg] = await v.push.deliverPending(APP);
  const { url } = JSON.parse(msg.payload);
  await v.page.route(/\/v1\/deliveries\/[^/?]+/, async (route) => {
    const res = await route.fetch(); const body = await res.json();
    await route.fulfill({ response: res, json: { ...body, imageUrl: `${APP}/icons/512.png` } });
  });
  await v.page.goto(url);
  const img = v.page.locator('img.quote-image');
  await img.waitFor();
  assert.equal(await img.getAttribute('src'), `${APP}/icons/512.png`);
  await v.context.close();
});

test('R5.5 (emulated): a lost subscription with permission still granted reconnects silently; no banner', async () => {
  const v = await iphone({ homeScreen: true });
  const enr = await onboardInApp(v.page, { name: 'Reconnect' });
  const first = (await platformMe(v.page)).devices.find((d) => d.status === 'active');
  // iOS dropped the subscription (for example after the app was removed and added again); permission stays granted.
  await v.page.evaluate(() => localStorage.removeItem('__fakePushSub'));
  await v.page.goto(APP);
  const devicesNow = await poll(async () => { const d = (await platformMe(v.page)).devices.filter((x) => x.status === 'active'); return d.length === 2 ? d : null; });
  assert.ok(devicesNow, 'a new subscription was stored without asking');
  assert.ok(devicesNow.some((d) => d.endpoint !== first.endpoint));
  await v.page.goto(`${APP}/manage`);
  await v.page.getByRole('heading', { name: 'My notes' }).waitFor();
  await v.page.getByText('After a break-up').first().waitFor();
  assert.equal(await v.page.getByText('Notifications are off on this device.').count(), 0, 'no banner after a silent reconnect');
  // And the next note goes to the new subscription.
  await stack.tick(enr.nextSendAt);
  assert.equal((await v.push.deliverPending(APP)).length >= 1, true);
  await v.context.close();
});

test('R5.5 (emulated): with permission gone, exactly one banner shows; "Stop notes on this device" is never undone silently', async () => {
  const v = await iphone({ homeScreen: true });
  await onboardInApp(v.page, { name: 'Banner' });
  // The person turned notifications off for the app in iOS Settings: permission is no longer granted.
  await v.page.evaluate(() => localStorage.removeItem('__fakePushSub'));
  await v.context.addInitScript(() => { Object.defineProperty(Notification, 'permission', { get: () => 'default', configurable: true }); });
  await v.page.goto(APP);
  const banner = v.page.getByRole('alert').filter({ hasText: 'Notifications are off on this device.' });
  await banner.waitFor();
  assert.equal(await banner.count(), 1);
  assert.equal(await banner.getByRole('link', { name: 'Turn them back on' }).count(), 1);
  // On My notes the fuller notice replaces it: still one.
  await v.page.goto(`${APP}/manage`);
  await v.page.getByRole('button', { name: 'Turn back on' }).waitFor();
  assert.equal(await v.page.getByText('Notifications are off on this device.').count(), 1);
  await v.context.close();

  // Someone who chose "Stop notes on this device" keeps that choice even though permission is still granted.
  const w = await iphone({ homeScreen: true });
  await onboardInApp(w.page, { name: 'Stopper' });
  await w.page.goto(`${APP}/manage`);
  await w.page.getByRole('button', { name: 'Stop notes on this device' }).click();
  await w.page.getByText('This device will no longer receive notes.').waitFor();
  await w.page.goto(APP);
  await w.page.reload();
  await w.page.waitForTimeout(800);
  assert.equal((await platformMe(w.page)).devices.filter((d) => d.status === 'active').length, 0, 'not resubscribed silently');
  await w.context.close();
});

test('R5.3: the manifest and page meta give iOS a standalone app with the icons it needs; no overflow on a small iPhone', async () => {
  const manifest = JSON.parse(readFileSync(join(here, '..', '..', 'client', 'public', 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.scope, '/');
  const v = await iphone({ device: devices['iPhone SE'] });
  await v.page.goto(APP);
  const head = await v.page.evaluate(() => ({
    touch: [...document.querySelectorAll('link[rel=apple-touch-icon]')].map((l) => ({ href: l.href, sizes: l.getAttribute('sizes') })),
    capable: document.querySelector('meta[name=apple-mobile-web-app-capable]')?.content,
    title: document.querySelector('meta[name=apple-mobile-web-app-title]')?.content,
    viewport: document.querySelector('meta[name=viewport]')?.content,
  }));
  assert.deepEqual(head.touch.map((t) => t.sizes), ['180x180']);
  assert.equal(head.capable, 'yes');
  assert.equal(head.title, 'outgrow');
  assert.match(head.viewport, /viewport-fit=cover/);
  // Every icon the manifest and the page name loads, with the size it claims.
  const sizes = await v.page.evaluate(async (srcs) => Promise.all(srcs.map((src) => new Promise((res) => { const i = new Image(); i.onload = () => res(`${i.naturalWidth}x${i.naturalHeight}`); i.onerror = () => res('missing'); i.src = src; }))),
    [...manifest.icons.map((i) => i.src), ...head.touch.map((t) => t.href)]);
  assert.deepEqual(sizes, [...manifest.icons.map((i) => i.sizes), '180x180']);
  assert.ok(manifest.icons.some((i) => i.purpose === 'maskable') && manifest.icons.some((i) => i.purpose === 'any'));
  for (const path of ['/', '/start', '/manage']) {
    await v.page.goto(APP + path);
    await v.page.locator('h1').first().waitFor();
    assert.equal(await v.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0, `overflow on ${path}`);
  }
  await v.context.close();
});
