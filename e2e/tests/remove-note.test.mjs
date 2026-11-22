// Admin topic page: find likely duplicate notes, remove one (it keeps its place), then restore it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '../pw.mjs';
import { startStack, APP } from '../stack.mjs';

const { zipSync, strToU8 } = createRequire(new URL('../../api/package.json', import.meta.url))('fflate');
let stack, browser;
before(async () => { stack = await startStack(); browser = await chromium.launch({ channel: 'chromium', headless: true }); });
after(async () => { await browser?.close(); await stack?.stop(); });

test('an editor finds a near-duplicate note, removes it after confirming, and can restore it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hmo-rm-'));
  const zipPath = join(dir, 'topics.zip');
  writeFileSync(zipPath, zipSync({
    'evenings.csv': strToU8('# slug: evenings\n# title: Quiet evenings\nbody\n"Turn the lights down an hour before bed tonight."\n"Write three lines about your day, then close the notebook."\n"Turn the lights down one hour before bed tonight."\n'),
  }));
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.route('**/auth/dev', (r) => { const b = JSON.parse(r.request().postData() ?? '{}'); return r.continue({ postData: JSON.stringify({ ...b, name: 'Owner' }) }); });
  await page.goto(`${APP}/admin/topics`);
  await page.getByRole('button', { name: 'Continue as demo user' }).click();
  await page.getByText('Import topics from a zip').click();
  await page.getByLabel('Zip file').setInputFiles(zipPath);
  await page.getByRole('button', { name: 'Preview' }).click();
  await page.getByRole('button', { name: 'Import 1 topic' }).click();
  await page.getByText('Done: 3 added').waitFor();

  await page.getByRole('link', { name: 'Quiet evenings' }).click();
  await page.getByText('3 notes').waitFor();
  await page.getByLabel(/Show likely duplicates only \(2\)/).check();
  const items = page.locator('ol.own-lines > li');
  assert.equal(await items.count(), 2); // both copies are shown, so the editor picks which one goes
  assert.match(await items.nth(0).innerText(), /like note 3/);

  page.once('dialog', (d) => { assert.match(d.message(), /Nobody's place in the course moves/); return d.accept(); });
  await items.nth(1).getByRole('button', { name: 'Remove' }).click();
  await page.getByText('2 notes (1 removed)').waitFor();
  await page.getByLabel(/Show likely duplicates only/).uncheck();
  assert.match(await items.nth(2).innerText(), /removed/);
  await items.nth(2).getByRole('button', { name: 'Restore' }).click();
  await page.getByText('3 notes', { exact: false }).waitFor();
  assert.doesNotMatch(await items.nth(2).innerText(), /removed/);
  assert.deepEqual(errors, []);
  await context.close();
});
