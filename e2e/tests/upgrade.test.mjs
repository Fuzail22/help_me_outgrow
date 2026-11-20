// G5 browser test: the separate upgrade page, a purchase through the local mock checkout, and the admin's orders.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, devices } from '../pw.mjs';
import { startStack, APP } from '../stack.mjs';

let stack, browser;
before(async () => { stack = await startStack(); browser = await chromium.launch({ channel: 'chromium', headless: true }); });
after(async () => { await browser?.close(); await stack?.stop(); });

async function person(name, path) {
  const context = await browser.newContext({ ...devices['Pixel 7'], timezoneId: 'Asia/Kolkata' });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.route('**/auth/dev', (route) => { const b = JSON.parse(route.request().postData() ?? '{}'); return route.continue({ postData: JSON.stringify({ ...b, name }) }); });
  await page.goto(APP + path);
  await page.getByRole('button', { name: 'Continue as demo user' }).click();
  return { context, page, errors };
}

test('buy one more notification a day on a topic (₹10, a year for the first buyers), then the next one costs ₹50', async () => {
  const p = await person('Buyer', '/upgrade');
  await p.page.getByRole('heading', { name: 'Upgrade' }).waitFor();
  const card = p.page.locator('.product').filter({ hasText: 'One more notification a day' });
  assert.equal(await card.getByRole('button').innerText(), 'Choose a topic first');
  await p.page.getByLabel(/For which topic/).selectOption({ label: 'Loss' });
  await card.getByText('₹10').waitFor();
  assert.match(await card.innerText(), /for 1 year/);
  await card.getByRole('button', { name: 'Buy' }).click();
  await p.page.getByRole('heading', { name: 'Test checkout' }).waitFor();
  await p.page.getByRole('button', { name: 'Pay (test)' }).click();
  await p.page.getByRole('heading', { name: 'Thank you' }).waitFor();
  assert.match(await p.page.locator('main').innerText(), /unlocked for 1 year/);
  const limits = await p.page.evaluate(() => fetch('/api/me/limits').then((r) => r.json()));
  const loss = limits.topics.find((t) => t.title === 'Loss');
  assert.equal(limits.perTopic[loss.id].maxSlots, 4);
  await p.page.goto(`${APP}/upgrade`);
  await p.page.getByLabel(/For which topic/).selectOption({ label: 'Loss' });
  await p.page.locator('.product').filter({ hasText: 'One more notification a day' }).getByText('₹50').waitFor();
  await p.page.getByText('What you have').waitFor();
  assert.deepEqual(p.errors, []);
  await p.context.close();

  const owner = await person('Owner', '/admin/orders');
  await owner.page.getByRole('heading', { name: 'Orders' }).waitFor();
  await owner.page.getByRole('cell', { name: 'buyer@dev.invalid' }).waitFor();
  assert.match(await owner.page.locator('main').innerText(), /vavp1 1/);
  await owner.context.close();
});
