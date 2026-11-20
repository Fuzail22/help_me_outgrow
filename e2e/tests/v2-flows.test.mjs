// v2 browser tests: enrolments through the app's backend, "not enough notes", the ending notice and "what's next".
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, devices } from '../pw.mjs';
import { startStack, APP } from '../stack.mjs';
import { wirePush, shownNotifications } from '../browser.mjs';

let stack, browser;
before(async () => { stack = await startStack(); browser = await chromium.launch({ channel: 'chromium', headless: true }); });
after(async () => { await browser?.close(); await stack?.stop(); });
const poll = async (fn, ms = 5000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return v; await new Promise((r) => setTimeout(r, 100)); } };

async function visitor(name) {
  const context = await browser.newContext({ ...devices['Pixel 7'], timezoneId: 'Asia/Kolkata', locale: 'en-IN' });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  const push = await wirePush(context, page, stack);
  await page.route('**/auth/dev', (route) => { const b = JSON.parse(route.request().postData() ?? '{}'); return route.continue({ postData: JSON.stringify({ ...b, name }) }); });
  return { context, page, push, errors };
}

test('onboarding warns when a schedule needs more notes than the topic has, and offers three ways to fit', async () => {
  const v = await visitor('Short topic');
  await v.page.goto(`${APP}/start`);
  await v.page.getByRole('button', { name: /Burnt out/ }).click();
  await v.page.getByLabel('Time 1', { exact: true }).fill('07:00');
  await v.page.getByRole('button', { name: '+ Add another time' }).click();
  await v.page.getByLabel('Time 2', { exact: true }).fill('20:00');
  await v.page.getByRole('button', { name: 'Continue' }).click();
  await v.page.getByRole('radio', { name: '3 months' }).click();
  const warn = v.page.getByRole('alert').filter({ hasText: 'your schedule needs' });
  await warn.waitFor();
  assert.match(await warn.innerText(), /This topic has 90 notes; your schedule needs 184/);
  assert.equal(await v.page.getByRole('button', { name: 'Continue' }).isDisabled(), true);
  await warn.getByRole('button', { name: /Start again from the first note/ }).click();
  assert.equal(await v.page.getByRole('button', { name: 'Continue' }).isDisabled(), false);
  await v.page.getByRole('button', { name: 'Continue' }).click();
  await v.page.getByRole('checkbox').check();
  await v.page.getByRole('button', { name: 'Continue as demo user' }).click();
  const created = v.page.waitForResponse((r) => r.url().endsWith('/api/enrolments') && r.request().method() === 'POST');
  await v.page.getByRole('button', { name: 'Turn on notifications' }).click();
  const enr = await (await created).json();
  assert.equal(enr.loop, true);
  assert.equal(enr.maxItems, 90);
  assert.deepEqual(v.errors, []);
  await v.context.close();
});

test('the last days of a course say so in the note, and "Choose what\'s next" leads to loop / extend / new course', async () => {
  const v = await visitor('Ending soon');
  await v.page.goto(`${APP}/start`);
  await v.page.getByRole('button', { name: /Burnt out/ }).click();
  await v.page.getByLabel('Time 1', { exact: true }).fill('07:00');
  await v.page.getByRole('button', { name: 'Continue' }).click();
  await v.page.getByRole('radio', { name: '1 week' }).click();
  await v.page.getByRole('button', { name: 'Continue' }).click();
  await v.page.getByRole('checkbox').check();
  await v.page.getByRole('button', { name: 'Continue as demo user' }).click();
  const created = v.page.waitForResponse((r) => r.url().endsWith('/api/enrolments') && r.request().method() === 'POST');
  await v.page.getByRole('button', { name: 'Turn on notifications' }).click();
  const enr = await (await created).json();
  // Five days in: three days left (inclusive), so the note carries the line and the button.
  const fifth = new Date(new Date(enr.nextSendAt).getTime() + 4 * 86400000).toISOString();
  for (let d = 0; d < 5; d++) await stack.tick(new Date(new Date(enr.nextSendAt).getTime() + d * 86400000).toISOString());
  const msgs = await v.push.deliverPending(APP);
  const last = JSON.parse(msgs.at(-1).payload);
  assert.match(last.body, /Notifications are about to end, choose what's next — 3 days left$/);
  assert.deepEqual(last.actions.map((a) => a.title), ['Helpful', "Choose what's next"]);
  assert.equal(last.actionKinds.next.url, `${APP}/next/${enr.id}`);
  const shown = await poll(async () => (await shownNotifications(v.context)).find((n) => n.tag === `enr:${enr.id}`));
  assert.ok(shown, 'one notification per course (tag enr:<id>)');
  void fifth;

  await v.page.goto(last.actionKinds.next.url);
  await v.page.getByRole('heading', { name: 'Your notes are about to end' }).waitFor();
  assert.equal(await v.page.getByRole('link', { name: 'How to unlock' }).count(), 1, 'nothing extra unlocked yet');
  await v.page.getByRole('button', { name: 'Loop again' }).click();
  await v.page.getByRole('heading', { name: 'My notes' }).waitFor();
  const list = await v.page.evaluate(() => fetch('/api/enrolments').then((r) => r.json()));
  const live = list.enrolments.filter((e) => e.status === 'active');
  assert.equal(live.length, 1);
  assert.equal(live[0].loop, true);
  assert.equal(list.enrolments.find((e) => e.id === enr.id).status, 'cancelled');
  assert.deepEqual(v.errors, []);
  await v.context.close();
});
