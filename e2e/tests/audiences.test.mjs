// G11 browser test: an admin makes a group, adds a person, and narrows a topic to that group; others stop seeing it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '../pw.mjs';
import { startStack, APP } from '../stack.mjs';

let stack, browser;
before(async () => { stack = await startStack(); browser = await chromium.launch({ channel: 'chromium', headless: true }); });
after(async () => { await browser?.close(); await stack?.stop(); });

async function signedIn(name, path) {
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.route('**/auth/dev', (route) => { const b = JSON.parse(route.request().postData() ?? '{}'); return route.continue({ postData: JSON.stringify({ ...b, name }) }); });
  await page.goto(APP + path);
  await page.getByRole('button', { name: 'Continue as demo user' }).click();
  return { context, page, errors };
}
const topicTitles = (page) => page.evaluate(async () => (await (await fetch('/api/me/limits')).json()).topics.map((t) => t.title));

test('a topic shown only to a group: members see it, everyone else does not, and Everyone brings it back', async () => {
  const asha = await signedIn('Asha', '/admin'); await asha.page.getByText('This account is not an admin').waitFor();
  const ravi = await signedIn('Ravi', '/admin'); await ravi.page.getByText('This account is not an admin').waitFor();
  assert.ok((await topicTitles(ravi.page)).includes('Loss'));

  const { context, page, errors } = await signedIn('Owner', '/admin/groups');
  await page.getByRole('heading', { name: 'Groups' }).waitFor();
  await page.getByLabel('Name').fill('Hospice volunteers');
  await page.getByRole('button', { name: 'Create' }).click();
  await page.getByRole('link', { name: 'Hospice volunteers' }).click();
  await page.getByText('Nobody in this group yet.').waitFor();
  await page.getByLabel(/Add a person/).fill('asha@');
  await page.getByRole('button', { name: 'Find' }).click();
  await page.getByRole('button', { name: 'Add' }).click();
  await page.getByRole('cell', { name: 'asha@dev.invalid' }).waitFor();

  await page.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name: 'Topics' }).click();
  await page.getByRole('link', { name: 'Loss' }).first().click();
  await page.getByRole('heading', { name: 'Who sees this topic' }).waitFor();
  await page.getByLabel('Only chosen groups and people (hidden from everyone else)').check();
  await page.getByLabel(/Hospice volunteers/).check();
  await page.getByRole('button', { name: 'Save' }).first().click();
  await page.getByText('Saved.').waitFor();
  await page.getByText('Now: 1 group — Hospice volunteers').waitFor();

  assert.ok((await topicTitles(asha.page)).includes('Loss'), 'a member still sees it');
  assert.ok(!(await topicTitles(ravi.page)).includes('Loss'), 'someone outside the group does not');

  await page.getByRole('radio', { name: 'Everyone', exact: true }).check();
  await page.getByRole('button', { name: 'Save' }).first().click();
  await page.getByText('Now: Everyone').waitFor();
  assert.ok((await topicTitles(ravi.page)).includes('Loss'));
  assert.deepEqual(errors, []);
  for (const c of [context, asha.context, ravi.context]) await c.close();
});
