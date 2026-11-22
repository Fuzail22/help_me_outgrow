import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { strToU8, zipSync } from 'fflate';
import { ORIGIN, setup } from './helpers.js';
import { parseTopicFile } from '../src/importer.js';

const W = { 'x-admin': '1' };
const zip = (files: Record<string, string>) => Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)]))));
const LOSS = `# slug: loss-2
# title: Loss, gently
# description: For when someone is gone.
# sensitive: true
# visibility: public
body,attribution,media,link
"Grief has no schedule.",,,
"You are allowed to rest, today and tomorrow.",A friend,https://img.example.org/rest.png,https://example.org/read?d={deliveryId}
`;
async function admin() {
  const s = await setup({ adminOwnerEmail: 'owner@dev.invalid' });
  const cookie = (await s.signIn('Owner')).cookie;
  const send = (buf: Buffer, dry: boolean) => request(s.app).post(`/api/admin/topics/import${dry ? '?dryRun=1' : ''}`).set('cookie', cookie).set('origin', ORIGIN).set(W).set('content-type', 'application/zip').send(buf);
  return { s, send };
}

describe('G10: bulk import of topics from a zip', () => {
  it('reads header lines and the notes table (media and link columns, aliases, quoted commas)', () => {
    const t = parseTopicFile('x.csv', '﻿# slug: x-1\n# title: X\n# repeat: yes\nText,Source,image_url,click_url\n"Comma, inside.",Me,,\n');
    expect(t).toMatchObject({ slug: 'x-1', errors: [], meta: { title: 'X', repeat: true, visibility: null } });
    expect(t.notes).toEqual([expect.objectContaining({ body: 'Comma, inside.', attribution: 'Me', imageUrl: null, clickUrl: null, row: 2 })]);
    const bad = parseTopicFile('b.csv', '# slug: Bad Slug\n# visibility: maybe\nbody,link\nok text here,http://insecure\n');
    expect(bad.errors).toEqual(expect.arrayContaining(['slug: 2 to 40 lower-case letters, digits or dashes', 'visibility must be public or private', 'row 2: the link must be an https:// address']));
  });
  it('previews without saving, then creates new topics and appends only new notes to existing ones', async () => {
    const { s, send } = await admin();
    s.platform.addTopic({ slug: 'burnt-out', title: 'Burnt out' }, 2); // lines "burnt-out line 1", "burnt-out line 2"
    const buf = zip({
      'topics/loss.csv': LOSS,
      'topics/burnt.csv': '# slug: burnt-out\n# title: Burnt out\nbody\nburnt-out line 1\nA brand new note for tired days.\n',
      'topics/broken.csv': '# title: No slug here\nbody\nSomething\n',
      '__MACOSX/._loss.csv': 'junk', 'readme.txt': 'ignored',
    });
    const pre = (await send(buf, true).expect(200)).body;
    expect(pre.topics.map((t: any) => [t.file, t.action, t.adding, t.duplicates])).toEqual([
      ['topics/broken.csv', 'skip', 1, 0], ['topics/burnt.csv', 'append', 1, 1], ['topics/loss.csv', 'create', 2, 0],
    ]);
    expect(pre.topics[0].errors).toEqual(['missing "# slug: …" line']);
    expect(pre.topics[2]).toMatchObject({ visibility: 'public', title: 'Loss, gently' });
    expect(s.platform.calls.filter((c) => ['createTopic', 'appendLines'].includes(c.method))).toEqual([]);

    const done = (await send(buf, false).expect(200)).body;
    expect(done.results.map((r: any) => [r.slug, r.action, r.added])).toEqual([[null, 'skip', 0], ['burnt-out', 'append', 1], ['loss-2', 'create', 2]]);
    const loss = s.platform.topicsList.find((t) => t.slug === 'loss-2')!;
    expect(loss).toMatchObject({ title: 'Loss, gently', visibility: 'public', sensitive: true });
    expect((await s.platform.lines(loss._id))[1]).toMatchObject({ attribution: 'A friend', imageUrl: 'https://img.example.org/rest.png', clickUrl: 'https://example.org/read?d={deliveryId}' });
    expect((await s.platform.lines(s.platform.topicsList.find((t) => t.slug === 'burnt-out')!._id)).map((l) => l.body)).toEqual(['burnt-out line 1', 'burnt-out line 2', 'A brand new note for tired days.']);
    // Running the same zip again adds nothing.
    const again = (await send(buf, false).expect(200)).body;
    expect(again.results.filter((r: any) => r.action !== 'skip').map((r: any) => r.added)).toEqual([0, 0]);
  });
  it('flags spam-like wording, refuses non-zips, duplicate slugs and reserved names; editors only', async () => {
    const { s, send } = await admin();
    const pre = (await send(zip({ 'a.csv': '# slug: aa\n# title: A\nbody\nCLAIM YOUR PRIZE NOW!!\n', 'b.csv': '# slug: aa\n# title: B\nbody\nx y z text\n', 'j.csv': '# slug: journal-prompts\n# title: J\nbody\nhello there friend\n' }), true).expect(200)).body;
    expect(pre.topics[0]).toMatchObject({ action: 'create', warnings: 1 });
    expect(pre.topics[1].errors).toContain('slug "aa" appears in more than one file');
    expect(pre.topics[2].errors).toContain('slug "journal-prompts" is reserved');
    expect((await send(Buffer.from('not a zip'), true).expect(422)).body.error.code).toBe('invalid_zip');
    const viewer = (await s.signIn('Viewer')).cookie;
    await request(s.app).post('/api/admin/admins').set('cookie', (await s.signIn('Owner')).cookie).set('origin', ORIGIN).set(W).send({ email: 'viewer@dev.invalid', role: 'viewer' }).expect(201);
    await request(s.app).post('/api/admin/topics/import?dryRun=1').set('cookie', viewer).set('origin', ORIGIN).set(W).set('content-type', 'application/zip').send(zip({ 'a.csv': LOSS })).expect(403);
  });
});
