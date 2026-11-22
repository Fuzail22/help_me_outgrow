// G7 browser test: write about a note from its page, reminders at own times (Write now / Later), export.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium, devices } from '../pw.mjs';
import { startStack, APP } from '../stack.mjs';
import { wirePush } from '../browser.mjs';

let stack, browser;
before(async () => { stack = await startStack(); browser = await chromium.launch({ channel: 'chromium', headless: true }); });
after(async () => { await browser?.close(); await stack?.stop(); });

test('from a received note to a journal entry; reminders arrive with Write now and Later; export is the writer’s', async () => {
  const context = await browser.newContext({ ...devices['Pixel 7'], timezoneId: 'Asia/Kolkata', acceptDownloads: true });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  const push = await wirePush(context, page, stack);
  await page.route('**/auth/dev', (route) => { const b = JSON.parse(route.request().postData() ?? '{}'); return route.continue({ postData: JSON.stringify({ ...b, name: 'Writer' }) }); });
  await page.goto(`${APP}/start`);
  await page.getByRole('button', { name: /Burnt out/ }).click();
  await page.getByLabel('Time 1', { exact: true }).fill('07:00');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('radio', { name: '1 month' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Continue as demo user' }).click();
  const created = page.waitForResponse((r) => r.url().endsWith('/api/enrolments') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Turn on notifications' }).click();
  const enr = await (await created).json();
  await stack.tick(enr.nextSendAt);
  const [msg] = await push.deliverPending(APP);
  const note = JSON.parse(msg.payload);

  await page.goto(note.url);
  await page.getByRole('link', { name: 'Write about this in my journal' }).click();
  await page.locator('blockquote.about').getByText(note.body).waitFor();
  await page.getByLabel('Write').fill('Today this was exactly right.');
  await page.getByRole('radio', { name: 'Good', exact: true }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await page.locator('.entries li').getByText('Today this was exactly right.').waitFor();
  assert.equal(await page.locator('.entries li blockquote').innerText(), note.body);

  await page.locator('summary', { hasText: 'Reminders' }).click();
  await page.getByRole('radio', { name: 'At my own times' }).click();
  await page.locator('.journal-more').getByLabel('Time 1', { exact: true }).fill('21:30');
  await page.getByRole('button', { name: 'Save reminders' }).click();
  await page.getByText(/Now: Every day at 9:30/i).waitFor();
  const list = await page.evaluate(() => fetch('/api/journal/reminder').then((r) => r.json()));
  assert.equal(list.mode, 'own');
  const all = await page.evaluate(() => fetch('/api/enrolments').then((r) => r.json()));
  const reminder = all.enrolments.find((e) => e.topicTitle === 'Journal');
  await stack.tick(reminder.nextSendAt);
  const [rm] = await push.deliverPending(APP);
  const r = JSON.parse(rm.payload);
  assert.deepEqual(r.actions.map((a) => a.title), ['Write now', 'Later']);
  assert.equal(r.actionKinds.later.kind, 'snooze');
  assert.match(r.actionKinds.write.url, new RegExp(`^${APP}/journal/new\\?d=`));

  await page.locator('summary', { hasText: 'Export or delete' }).click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Download as text (Markdown)' }).click()]);
  const md = readFileSync(await dl.path(), 'utf8');
  assert.match(md, /# My journal/); assert.match(md, /Today this was exactly right\./); assert.match(md, /feeling good/);
  assert.deepEqual(errors, []);
  await context.close();
});
