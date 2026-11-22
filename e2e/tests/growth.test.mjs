// G2–G4 browser tests: referral link → level 1 → celebration with the unlock → one pick; own topic; proof review.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from '../pw.mjs';
import { startStack, APP } from '../stack.mjs';

const shots = join(dirname(fileURLToPath(import.meta.url)), '..', 'test-results');
let stack, browser;
before(async () => { stack = await startStack(); browser = await chromium.launch({ channel: 'chromium', headless: true }); });
after(async () => { await browser?.close(); await stack?.stop(); });

async function person(name, path = '/growth') {
  const context = await browser.newContext({ ...devices['Pixel 7'], timezoneId: 'Asia/Kolkata' });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.route('**/auth/dev', (route) => { const b = JSON.parse(route.request().postData() ?? '{}'); return route.continue({ postData: JSON.stringify({ ...b, name }) }); });
  await page.goto(APP + path);
  await page.getByRole('button', { name: 'Continue as demo user' }).click();
  return { context, page, errors };
}

test('a friend opens my link on their phone → level 1 → the lock opens → I choose one more time a day on a topic', async () => {
  const me = await person('Grower');
  await me.page.getByRole('heading', { name: 'Grow with us' }).waitFor();
  const url = await me.page.locator('.reflink code').innerText();
  assert.match(url, new RegExp(`^${APP}/r/[a-z2-9]{8}$`));
  assert.match(await me.page.locator('.levels > li').first().innerText(), /Rate 9 notes[\s\S]*Someone opens your link/);

  // My own visit to my link does not count.
  await me.page.goto(url); await me.page.waitForURL(`${APP}/?welcome=1`);
  // A friend's phone does.
  const friend = await browser.newContext({ ...devices['Pixel 7'] });
  const fp = await friend.newPage();
  await fp.goto(url); await fp.waitForURL(`${APP}/?welcome=1`);
  await fp.getByText('A friend shared this with you').waitFor();
  await friend.close();

  await me.page.goto(`${APP}/manage`);
  const dialog = me.page.getByRole('dialog', { name: 'Level 1 reached' });
  await dialog.waitFor();
  await me.page.waitForFunction(() => document.querySelector('dialog.celebrate .unlock.open'));
  await me.page.waitForTimeout(700);
  await me.page.screenshot({ path: join(shots, 'level-1-unlocked.png') });
  await dialog.getByRole('radio', { name: /More notes a day/ }).click();
  await dialog.getByLabel('For which topic?').selectOption({ label: 'Burnt out' });
  await dialog.getByRole('button', { name: 'Unlock it' }).click();
  await dialog.getByText('You chose More notes a day').waitFor();
  await dialog.getByRole('button', { name: 'Done' }).click();
  const limits = await me.page.evaluate(() => fetch('/api/me/limits').then((r) => r.json()));
  const burnt = limits.topics.find((t) => t.title === 'Burnt out');
  assert.equal(limits.perTopic[burnt.id].maxSlots, 4);
  // Shown once only.
  await me.page.reload(); await me.page.waitForTimeout(800);
  assert.equal(await me.page.getByRole('dialog').count(), 0);
  assert.deepEqual(me.errors, []);
  await me.context.close();
});

test('a social post: the person says they sent it, support approves it in the admin, and it counts', async () => {
  const p = await person('Poster');
  await p.page.getByRole('button', { name: 'I have sent the screenshot' }).click();
  await p.page.getByText('Thanks. We will review it soon.').waitFor();
  const owner = await person('Owner', '/admin');
  await owner.page.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name: 'Social posts' }).click();
  const row = owner.page.getByRole('row', { name: /Poster/ });
  await row.getByRole('button', { name: 'Approve' }).click();
  await owner.page.getByText('Nothing here.').waitFor();
  await owner.context.close();
  await p.page.reload();
  await p.page.getByRole('dialog', { name: 'Level 1 reached' }).waitFor();
  await p.context.close();
});

test('an owner grants an own topic; the person writes notes, gets a spam-wording flag, and can follow it', async () => {
  const p = await person('Writer', '/my-topic');
  await p.page.getByText('Unlock it at a level').waitFor();
  const owner = await person('Owner', '/admin/people');
  await owner.page.getByLabel('Email, id or referral code').fill('writer@dev.invalid');
  await owner.page.getByRole('button', { name: 'Find' }).click();
  await owner.page.getByRole('link', { name: 'Writer' }).click();
  // The grant form has no own-topic option by design; use the api as an owner would through support tooling.
  const id = owner.page.url().split('/').pop();
  const status = await owner.page.evaluate(async (id) => (await fetch(`/api/admin/users/${id}/entitlements`, { method: 'POST', headers: { 'x-admin': '1', 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'own_topic', topicId: null, amount: 1, months: 12, note: 'pilot' }) })).status, id);
  assert.equal(status, 201);
  await owner.context.close();
  await p.page.reload();
  await p.page.getByLabel('Title').fill('Morning courage');
  await p.page.getByRole('button', { name: 'Create' }).click();
  await p.page.getByLabel(/Add notes, one per line/).fill('You have handled hard mornings before.\nCLAIM YOUR PRIZE NOW!!');
  await p.page.getByRole('button', { name: 'Add' }).click();
  await p.page.getByText('May look like spam').waitFor();
  await p.page.goto(`${APP}/start`);
  await p.page.getByRole('button', { name: /Morning courage/ }).waitFor();
  await p.context.close();
});
