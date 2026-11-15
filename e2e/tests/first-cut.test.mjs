import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from '../pw.mjs';
import { startStack, APP, PLATFORM } from '../stack.mjs';
import { wirePush, shownNotifications, tapNotification } from '../browser.mjs';

const here = dirname(fileURLToPath(import.meta.url));
let stack, browser;
before(async () => { stack = await startStack(); browser = await chromium.launch({ channel: 'chromium', headless: true }); });
after(async () => { await browser?.close(); await stack?.stop(); });

const localTime = (iso, tz) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
const poll = async (fn, ms = 5000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return v; await new Promise((r) => setTimeout(r, 100)); } };

/** A visitor's browser. `grant: false` leaves the notification permission to the browser's own answer. */
async function visitor({ device = devices['Pixel 7'], timezoneId = 'Asia/Kolkata', grant = true, userAgent } = {}) {
  const context = await browser.newContext({ ...device, ...(userAgent ? { userAgent } : {}), timezoneId, locale: 'en-IN' });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  const push = grant ? await wirePush(context, page, stack) : null;
  return { context, page, push, errors };
}

/** Landing page to confirmed enrolment, as a person would click through it. Returns the created enrolment. */
async function onboard(page, { topic = /Burnt out/, time = '07:00', name } = {}) {
  await page.goto(APP);
  await page.getByRole('link', { name: 'Choose what you need' }).click();
  await page.getByRole('button', { name: topic }).click();
  await page.getByLabel('Time 1').fill(time);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('radio', { name: '1 month' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('checkbox').check();
  if (name) await page.route('**/auth/dev', (route) => route.continue({ postData: JSON.stringify({ name }) }));
  await page.getByRole('button', { name: 'Continue as demo user' }).click();
  const created = page.waitForResponse((r) => r.url().endsWith('/v1/subscribers/me/enrolments') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Turn on notifications' }).click();
  const enrolment = await (await created).json();
  await page.getByRole('heading', { name: 'You are set.' }).waitFor();
  return enrolment;
}

test('Android Chrome: landing page to a confirmed enrolment in under 60 seconds', async () => {
  const v = await visitor();
  const t0 = Date.now();
  const enr = await onboard(v.page, { name: 'Timing' });
  const seconds = (Date.now() - t0) / 1000;
  assert.ok(seconds < 60, `took ${seconds}s`);
  assert.equal(enr.status, 'active');
  assert.ok(['Asia/Kolkata', 'Asia/Calcutta'].includes(enr.timezone)); // Chrome reports the older alias; both are the same zone
  assert.equal(enr.slots.length, 7);
  assert.match(await v.page.locator('main').innerText(), /Your first note for “Burnt out” arrives/);
  // Seven interactions from the landing page: CTA, topic, continue, continue, consent, sign in, allow.
  const me = await v.page.evaluate(() => fetch('/auth/me').then((r) => r.json()));
  assert.equal(me.user.name, 'Timing');
  assert.deepEqual(v.errors, []);
  console.log(`      scripted run: ${seconds.toFixed(1)} s, 7 interactions`);
  await v.context.close();
});

test('a 07:00 slot fires at 07:00 local in Asia/Kolkata and in America/New_York, and the notification appears', async () => {
  for (const tz of ['Asia/Kolkata', 'America/New_York']) {
    const v = await visitor({ timezoneId: tz });
    const enr = await onboard(v.page, { name: `Zone ${tz}`, time: '07:00' });
    assert.equal(localTime(enr.nextSendAt, tz), '07:00');
    const shownBefore = (await stack.stats()).delivery.shown;
    // One minute early: nothing is due for this person.
    await stack.tick(new Date(Date.parse(enr.nextSendAt) - 60000).toISOString());
    assert.equal((await v.push.deliverPending(APP)).length, 0);
    // The tick at 07:00:00 local sends it.
    await stack.tick(enr.nextSendAt);
    const msgs = await v.push.deliverPending(APP);
    assert.equal(msgs.length, 1);
    const [msg] = msgs;
    assert.equal(msg.headers.ttl, '14400');
    const notes = await poll(async () => { const n = await shownNotifications(v.context); return n.length ? n : null; });
    assert.equal(notes.length, 1);
    assert.equal(notes[0].title, 'Burnt out');
    assert.match(notes[0].body, /You are tired in a way that sleep alone does not mend/); // line 0 of the seeded topic
    assert.deepEqual(notes[0].actions, ['up', 'down']);
    assert.ok(notes[0].data.url.startsWith(`${APP}/n/`));
    assert.ok(await poll(async () => (await stack.stats()).delivery.shown === shownBefore + 1)); // the worker reported "shown"
    await v.context.close();
  }
});

test('tapping the notification reports the click and the quote page takes a rating and a comment', async () => {
  const v = await visitor();
  const enr = await onboard(v.page, { name: 'Rater', topic: /Loss/ });
  const before = (await stack.stats()).delivery;
  await stack.tick(enr.nextSendAt);
  await v.push.deliverPending(APP);
  const [note] = await poll(async () => { const n = await shownNotifications(v.context); return n.length ? n : null; });
  await poll(async () => (await stack.stats()).delivery.shown > before.shown); // the worker reported "shown"
  const url = await tapNotification(v.context, note.tag);
  await poll(async () => (await stack.stats()).delivery.clicked > before.clicked);
  const s1 = (await stack.stats()).delivery;
  assert.equal(s1.shown, before.shown + 1); assert.equal(s1.clicked, before.clicked + 1);

  // The click URL works on its own, with no session: open it in a signed-out browser.
  const fresh = await browser.newContext(devices['Pixel 7']); const q = await fresh.newPage();
  await q.goto(url);
  await q.locator('blockquote').waitFor();
  assert.match(await q.locator('blockquote').innerText(), /Grief has no schedule/);
  assert.match(await q.locator('footer').innerText(), /not a substitute for professional help/);
  assert.equal(await q.locator('footer a', { hasText: 'find a helpline' }).count(), 1);
  await q.getByRole('button', { name: 'Helpful' }).click();
  await q.getByLabel(/What made it land/).fill('It did not rush me.');
  await q.getByRole('button', { name: 'Send' }).click();
  await q.getByText('Thank you. Saved.').waitFor();
  await q.reload();
  await q.locator('blockquote').waitFor();
  assert.equal(await q.getByRole('button', { name: 'Helpful' }).getAttribute('aria-pressed'), 'true'); // the rating persisted
  const stats = await stack.stats();
  assert.ok(stats.helpfulnessByItem.some((i) => i.topic === 'Loss' && i.up === 1 && i.seq === 0));
  assert.ok(stats.ratings.comments >= 1);
  await fresh.close(); await v.context.close();
});

test('rating straight from the notification action button is recorded', async () => {
  const v = await visitor();
  const enr = await onboard(v.page, { name: 'Action', topic: /Low mood/ });
  await stack.tick(enr.nextSendAt);
  await v.push.deliverPending(APP);
  const [note] = await poll(async () => { const n = await shownNotifications(v.context); return n.length ? n : null; });
  const before = (await stack.stats()).ratings.down;
  await tapNotification(v.context, note.tag, 'down');
  assert.ok(await poll(async () => (await stack.stats()).ratings.down === before + 1));
  await v.context.close();
});

test('manage page: pause, resume, change times, stop with a reason', async () => {
  const v = await visitor();
  await onboard(v.page, { name: 'Manager', topic: /After a break-up/ });
  await v.page.getByRole('link', { name: 'See my notes' }).click();
  const card = v.page.locator('.enrolment').first();
  await card.getByText('Every day at').waitFor();
  await card.getByRole('button', { name: 'Pause' }).click();
  await card.getByText('Paused', { exact: true }).waitFor();
  await stack.tick(new Date(Date.now() + 86400000).toISOString());
  assert.equal((await v.push.deliverPending(APP)).length, 0); // paused: nothing goes out
  await card.getByRole('button', { name: 'Resume' }).click();
  await card.getByText('On', { exact: true }).waitFor();
  await card.getByRole('button', { name: 'Change times' }).click();
  await card.getByLabel('Time 1').fill('21:30');
  await card.getByRole('button', { name: '+ Add another time' }).click();
  await card.getByRole('button', { name: 'Sat' }).click(); await card.getByRole('button', { name: 'Sun' }).click();
  const patched = v.page.waitForResponse((r) => r.request().method() === 'PATCH');
  await card.getByRole('button', { name: 'Save times' }).click();
  const body = await (await patched).json();
  assert.equal(body.slots.length, 10); // 5 weekdays x 2 times
  assert.ok(body.slots.some((x) => x.time === localTime(body.nextSendAt, 'Asia/Kolkata'))); // next send is at one of the new times, local
  await card.getByText(/Weekdays at/).waitFor();
  await card.getByRole('button', { name: 'Stop', exact: true }).click();
  await card.getByRole('combobox').selectOption('feeling_better');
  await card.getByRole('button', { name: 'Stop notes' }).click();
  await v.page.getByText('You have no notes scheduled right now.').waitFor();
  assert.equal((await stack.stats()).cancelReasons.feeling_better, 1);
  await v.context.close();
});

test('unsubscribing in the browser expires the device on the next send; the next visit offers resubscribe and delivery resumes', async () => {
  const v = await visitor();
  const enr = await onboard(v.page, { name: 'Lapsed' });
  // The person removes the site's notification permission: the push service now answers 410 Gone.
  const sub = await v.page.evaluate(() => JSON.parse(localStorage.getItem('__fakePushSub')));
  stack.push.setStatus(sub.id, 410);
  await v.page.evaluate(() => localStorage.removeItem('__fakePushSub'));
  const expiredBefore = (await stack.stats()).totals.devicesExpired;
  await stack.tick(enr.nextSendAt);
  assert.equal((await stack.stats()).totals.devicesExpired, expiredBefore + 1);
  assert.equal((await v.push.deliverPending(APP)).length, 0);

  await v.page.goto(`${APP}/manage`);
  await v.page.getByText('Notifications are off on this device.').waitFor();
  const resubBefore = (await stack.stats()).lifecycle.resubscribed;
  await v.page.getByRole('button', { name: 'Turn back on' }).click();
  await v.page.getByText('Notifications are back on for this device.').waitFor();
  assert.equal((await stack.stats()).lifecycle.resubscribed, resubBefore + 1);
  assert.equal(await v.page.getByText('Notifications are off on this device.').count(), 0);

  // Next day's slot arrives on the new subscription, with the line that failed to arrive yesterday.
  const next = new Date(Date.parse(enr.nextSendAt) + 86400000).toISOString();
  await stack.tick(next);
  const [msg] = await v.push.deliverPending(APP);
  assert.ok(msg, 'the new subscription received the next slot');
  assert.match(JSON.parse(msg.payload).body, /You are tired in a way that sleep alone does not mend/);
  await v.context.close();
});

test('a blocked permission prompt saves nothing and explains how to allow', async () => {
  const v = await visitor({ grant: false });
  await v.context.addInitScript(() => { Notification.requestPermission = async () => 'denied'; });
  const enrolledBefore = (await stack.stats()).funnel.enrolled;
  await v.page.goto(`${APP}/start`);
  await v.page.getByRole('button', { name: /Burnt out/ }).click();
  await v.page.getByRole('button', { name: 'Continue' }).click();
  await v.page.getByRole('button', { name: 'Continue' }).click();
  await v.page.getByRole('checkbox').check();
  await v.page.route('**/auth/dev', (route) => route.continue({ postData: JSON.stringify({ name: 'Blocked' }) }));
  await v.page.getByRole('button', { name: 'Continue as demo user' }).click();
  await v.page.getByRole('button', { name: 'Turn on notifications' }).click();
  await v.page.getByText('Notifications are blocked for this site.').waitFor();
  await v.page.getByRole('button', { name: 'Try again' }).waitFor();
  assert.ok(await poll(async () => (await stack.stats()).funnel.permission_denied >= 1));
  assert.equal((await stack.stats()).funnel.enrolled, enrolledBefore);
  await v.context.close();
});

test('iPhone Safari is told to add the site to the Home Screen, and interest is counted', async () => {
  const v = await visitor({ device: devices['iPhone 14'], grant: false });
  await v.page.goto(`${APP}/start`);
  await v.page.getByRole('button', { name: /Burnt out/ }).click();
  await v.page.getByRole('button', { name: 'Continue' }).click();
  await v.page.getByRole('button', { name: 'Continue' }).click();
  await v.page.getByRole('checkbox').check();
  await v.page.route('**/auth/dev', (route) => route.continue({ postData: JSON.stringify({ name: 'iPhone' }) }));
  await v.page.getByRole('button', { name: 'Continue as demo user' }).click();
  await v.page.getByRole('button', { name: 'Turn on notifications' }).click();
  await v.page.getByText('On iPhone and iPad, add this site to your Home Screen first.').waitFor();
  const before = (await stack.stats()).lifecycle.ios_interest;
  await v.page.getByRole('button', { name: 'I would use this on my iPhone' }).click();
  await v.page.getByText('Thanks, noted.').waitFor();
  assert.ok(await poll(async () => (await stack.stats()).lifecycle.ios_interest === before + 1));
  await v.context.close();
});

test('erase my data removes the person from the platform and the app', async () => {
  const v = await visitor();
  await onboard(v.page, { name: 'Eraser' });
  const before = (await stack.stats()).totals;
  await v.page.goto(`${APP}/manage`);
  await v.page.getByRole('button', { name: 'Erase my data' }).click();
  await v.page.getByRole('alertdialog').getByRole('button', { name: 'Erase my data' }).click();
  await v.page.getByRole('heading', { name: 'Sign in to see your notes' }).waitFor();
  const after = (await stack.stats()).totals;
  assert.equal(after.subscribers, before.subscribers - 1);
  assert.equal(after.enrolmentsActive, before.enrolmentsActive - 1);
  assert.equal((await v.page.evaluate(() => fetch('/auth/me').then((r) => r.status))), 401);
  await v.context.close();
});

test('the app is installable and the pages have no layout overflow on a phone', async () => {
  const v = await visitor();
  await v.page.goto(APP);
  const manifest = await v.page.evaluate(async () => (await fetch(document.querySelector('link[rel=manifest]').href)).json());
  assert.equal(manifest.display, 'standalone');
  assert.deepEqual(manifest.icons.map((i) => i.sizes), ['192x192', '512x512']);
  for (const path of ['/', '/start', '/privacy', '/manage']) {
    await v.page.goto(APP + path);
    await v.page.locator('h1').first().waitFor();
    const overflow = await v.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.equal(overflow, 0, `horizontal overflow on ${path}`);
  }
  assert.equal((await v.page.goto(`${APP}/sw-core.js`)).status(), 200); // the worker core is served from the app's own origin
  await v.context.close();
});

test('the stats script prints the funnel and the health numbers', async () => {
  const ns = resolve(process.env.NS_REPO ?? join(here, '..', '..', '..', 'notification-service'));
  const out = execFileSync(join(ns, 'server', 'node_modules', '.bin', 'tsx'), ['scripts/stats.ts', '--api', PLATFORM, '--key', stack.tenant.secretKey], { cwd: join(ns, 'server') }).toString();
  for (const label of ['Funnel', 'visit', 'permission_granted', 'enrolled', 'Opt-in rate', 'Activation', 'Reach (floor)', 'Engagement', 'Helpfulness', 'Retention', 'Reach by browser', 'Chrome / Android', 'Engagement by topic', 'Most-rated lines']) {
    assert.ok(out.includes(label), `stats output is missing "${label}"`);
  }
  console.log(out.split('\n').map((l) => '      ' + l).join('\n'));
});
