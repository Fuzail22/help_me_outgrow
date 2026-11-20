// G1 browser tests: the admin at /admin — owner signs in, edits settings with explanations, invites, audit.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '../pw.mjs';
import { startStack, APP } from '../stack.mjs';

let stack, browser;
before(async () => { stack = await startStack(); browser = await chromium.launch({ channel: 'chromium', headless: true }); });
after(async () => { await browser?.close(); await stack?.stop(); });

export async function signedIn(name, path = '/admin') {
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.route('**/auth/dev', (route) => { const b = JSON.parse(route.request().postData() ?? '{}'); return route.continue({ postData: JSON.stringify({ ...b, name }) }); });
  await page.goto(APP + path);
  await page.getByRole('button', { name: 'Continue as demo user' }).click();
  return { context, page, errors };
}

test('the owner edits limits and growth settings, invites a support admin, and every change is in the audit log', async () => {
  const { context, page, errors } = await signedIn('Owner');
  await page.getByRole('heading', { name: 'Overview' }).waitFor();
  await page.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name: 'Settings' }).click();
  await page.getByText('What everyone gets before any level or purchase').waitFor();
  await page.getByLabel('Quotes per course').fill('95');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByText('Saved.').waitFor();
  await page.getByRole('link', { name: 'Levels and VAVP' }).click();
  await page.getByRole('button', { name: '+ Add level 3' }).click();
  await page.getByLabel('VAVP1 at level 3').fill('3');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByText('Saved.').waitFor();
  await page.getByRole('link', { name: 'Paid privileges' }).click();
  await page.getByRole('cell', { name: '₹240' }).first().waitFor(); // buyer 200: ₹50 + 19 × ₹10
  await page.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name: 'Admins' }).click();
  await page.getByLabel('Invite by email').fill('helper@dev.invalid');
  await page.locator('form.inline-form select').selectOption('support');
  await page.getByRole('button', { name: 'Invite' }).click();
  await page.getByRole('cell', { name: 'helper@dev.invalid' }).waitFor();
  await page.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name: 'Audit log' }).click();
  await page.getByText('admin.invite').waitFor();
  const actions = await page.locator('.audit li strong').allInnerTexts();
  assert.deepEqual(actions, ['admin.invite', 'settings.growth', 'settings.limits']);
  assert.deepEqual(errors, []);
  await context.close();

  // The new support admin sees People but not Settings writes, Admins or the audit log.
  const helper = await signedIn('Helper');
  await helper.page.getByRole('heading', { name: 'Overview' }).waitFor();
  const nav = await helper.page.getByRole('navigation', { name: 'Admin' }).getByRole('link').allInnerTexts();
  assert.ok(nav.includes('People') && !nav.includes('Admins') && !nav.includes('Audit log'), nav.join(', '));
  await helper.context.close();

  // Someone who was never invited is told so.
  const stranger = await signedIn('Stranger');
  await stranger.page.getByText('This account is not an admin').waitFor();
  await stranger.context.close();
});
