// G10 browser test: admin imports topics from a zip (preview, then import); a note's own link opens on tap.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, devices } from '../pw.mjs';
import { startStack, APP } from '../stack.mjs';
import { wirePush } from '../browser.mjs';

const { zipSync, strToU8 } = createRequire(new URL('../../api/package.json', import.meta.url))('fflate');
let stack, browser;
before(async () => { stack = await startStack(); browser = await chromium.launch({ channel: 'chromium', headless: true }); });
after(async () => { await browser?.close(); await stack?.stop(); });

test('import a zip of topics: preview shows what will happen, import creates and appends, links reach the notification', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hmo-zip-'));
  const zipPath = join(dir, 'topics.zip');
  writeFileSync(zipPath, zipSync({
    'mornings.csv': strToU8('# slug: mornings\n# title: Hard mornings\n# description: For days that start heavy.\n# visibility: public\nbody,attribution,media,link\n"You have handled hard mornings before.",,,https://example.org/mornings?d={deliveryId}\n"One small step, then the next.",,,\n'),
    'burnt-out.csv': strToU8('# slug: burnt-out\n# title: Burnt out\nbody\n"A note added later, for tired weeks."\n'),
    'bad.csv': strToU8('# title: Missing slug\nbody\nhello there\n'),
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
  const table = page.getByRole('table', { name: 'Import preview' });
  await table.waitFor();
  assert.match(await table.getByRole('row', { name: /mornings\.csv/ }).innerText(), /New topic \(public\)[\s\S]*\+2/);
  assert.match(await table.getByRole('row', { name: /burnt-out\.csv/ }).innerText(), /Add to existing topic[\s\S]*\+1/);
  assert.match(await table.getByRole('row', { name: /bad\.csv/ }).innerText(), /Skipped[\s\S]*missing "# slug/);
  await page.getByRole('button', { name: 'Import 2 topics' }).click();
  await table.getByText('Done: 2 added').waitFor();
  await table.getByText('Done: 1 added').waitFor();
  assert.deepEqual(errors, []);
  await context.close();

  // A person follows the new topic; the first note opens the note's own link.
  const v = await browser.newContext({ ...devices['Pixel 7'], timezoneId: 'Asia/Kolkata' });
  const p = await v.newPage();
  const push = await wirePush(v, p, stack);
  await p.route('**/auth/dev', (r) => { const b = JSON.parse(r.request().postData() ?? '{}'); return r.continue({ postData: JSON.stringify({ ...b, name: 'Morning reader' }) }); });
  await p.goto(`${APP}/start`);
  await p.getByRole('button', { name: /Hard mornings/ }).click();
  await p.getByLabel('Time 1', { exact: true }).fill('07:00');
  await p.getByRole('button', { name: 'Continue' }).click();
  await p.getByRole('radio', { name: '1 week' }).click();
  // Two notes for a week: loop so the schedule fits.
  await p.getByRole('button', { name: /Start again from the first note/ }).click();
  await p.getByRole('button', { name: 'Continue' }).click();
  await p.getByRole('checkbox').check();
  await p.getByRole('button', { name: 'Continue as demo user' }).click();
  const created = p.waitForResponse((r) => r.url().endsWith('/api/enrolments') && r.request().method() === 'POST');
  await p.getByRole('button', { name: 'Turn on notifications' }).click();
  const enr = await (await created).json();
  await stack.tick(enr.nextSendAt);
  const [msg] = await push.deliverPending(APP);
  const note = JSON.parse(msg.payload);
  assert.equal(note.body, 'You have handled hard mornings before.');
  assert.equal(note.url, `https://example.org/mornings?d=${note.deliveryId}`);
  await v.close();
});
