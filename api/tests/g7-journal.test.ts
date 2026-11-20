import { describe, expect, it } from 'vitest';
import { ALL_DAYS, setup } from './helpers.js';

const W = { 'x-admin': '1' };

describe('G7: journal', () => {
  it('stores entries encrypted (no plain text in the database), returns them to their writer only', async () => {
    const s = await setup();
    const a = await s.signIn('Asha'); const b = await s.signIn('Bea');
    const e = (await s.as(a.cookie).post('/api/journal', { text: 'A secret sentence about Monday.', mood: 2 }).expect(201)).body;
    expect(e).toMatchObject({ text: 'A secret sentence about Monday.', mood: 2, quote: null });
    const raw = JSON.stringify(await s.ctx.store.journal.find({}));
    expect(raw).not.toContain('secret sentence');
    expect((await s.as(a.cookie).get('/api/journal').expect(200)).body.entries.map((x: any) => x.text)).toEqual(['A secret sentence about Monday.']);
    expect((await s.as(b.cookie).get('/api/journal').expect(200)).body.entries).toEqual([]);
    await s.as(b.cookie).patch(`/api/journal/${e.id}`, { text: 'x' }).expect(404);
    await s.as(b.cookie).del(`/api/journal/${e.id}`).expect(404);
    // Tampering with the ciphertext is detected (GCM), not silently decrypted to garbage.
    const doc = (await s.ctx.store.journal.findOne({ _id: e.id }))!;
    const flipped = Buffer.from(doc.ct, 'base64'); flipped[0] ^= 1;
    await s.ctx.store.journal.updateOne({ _id: e.id }, { $set: { ct: flipped.toString('base64') } });
    expect((await s.as(a.cookie).get('/api/journal')).status).toBe(502);
  });
  it('writes about a quote it received (a copy of the words, checked as theirs by the platform), or a reminder prompt', async () => {
    const s = await setup();
    const a = await s.signIn('Asha');
    s.platform.deliveries.set('d1', { externalId: a.id, body: 'Grief has no schedule.', attribution: null, topic: 'Loss' });
    s.platform.deliveries.set('d2', { externalId: 'someone-else', body: 'x', attribution: null, topic: 'Loss' });
    s.platform.deliveries.set('d3', { externalId: a.id, body: 'What helped today?', attribution: null, topic: 'journal-prompts' });
    const e = (await s.as(a.cookie).post('/api/journal', { text: 'It really does not.', deliveryId: 'd1' }).expect(201)).body;
    expect(e.quote).toEqual({ body: 'Grief has no schedule.', attribution: null, topic: 'Loss', deliveryId: 'd1' });
    await s.as(a.cookie).post('/api/journal', { text: 'x', deliveryId: 'd2' }).expect(404);
    expect((await s.as(a.cookie).post('/api/journal', { text: 'A walk.', deliveryId: 'd3' }).expect(201)).body).toMatchObject({ quote: null, prompt: 'What helped today?' });
  });
  it('exports as JSON and Markdown, deletes everything only with the typed confirmation', async () => {
    const s = await setup();
    const a = await s.signIn('Asha'); const c = s.as(a.cookie);
    await c.post('/api/journal', { text: 'First', mood: 4 }).expect(201);
    await c.post('/api/journal', { text: 'Second' }).expect(201);
    const json = await c.get('/api/journal/export').expect(200);
    expect(json.headers['content-disposition']).toMatch(/attachment; filename="journal-2026-11-20.json"/);
    expect(json.body.entries.map((e: any) => e.text)).toEqual(['First', 'Second']);
    const md = await c.get('/api/journal/export?format=md').expect(200);
    expect(md.text).toMatch(/^# My journal/); expect(md.text).toContain('feeling good');
    await c.del('/api/journal').send({ confirm: 'yes' }).expect(422);
    expect((await c.del('/api/journal').send({ confirm: 'delete everything' }).expect(200)).body.deleted).toBe(2);
  });
  it('reminders: own times create a looping enrolment on the private Journal topic with Write now / Later buttons', async () => {
    const s = await setup();
    const a = await s.signIn('Asha'); const c = s.as(a.cookie);
    const rr = await c.put('/api/journal/reminder', { mode: 'own', slots: ALL_DAYS('21:30'), timezone: 'Asia/Kolkata' }); if (rr.status !== 200) console.log(JSON.stringify(s.logs.at(-1))); expect(rr.status).toBe(200);
    const topic = s.platform.topicsList.find((t) => t.slug === 'journal-prompts')!;
    expect(topic).toMatchObject({ visibility: 'private', repeat: true, itemCount: 20 });
    expect(topic.actions!.map((x) => [x.title, x.kind])).toEqual([['Write now', 'open'], ['Later', 'snooze']]);
    const r = (await c.get('/api/journal/reminder').expect(200)).body;
    expect(r).toMatchObject({ mode: 'own', timezone: 'Asia/Kolkata', endDate: '2027-11-19' });
    const enr = [...s.platform.enrol.values()].find((e) => e.topicId === topic._id)!;
    expect(enr).toMatchObject({ loop: true, maxItems: null });
    // The Journal topic is never offered as a course.
    expect((await c.get('/api/me/limits').expect(200)).body.topics.map((t: any) => t.slug)).not.toContain('journal-prompts');
    await c.put('/api/journal/reminder', { mode: 'off' }).expect(200);
    expect(s.platform.enrol.get(enr.id)!.status).toBe('cancelled');
  });
  it('reminders tied to quotes: no extra notification; the quote topic gets a "Journal on this" button', async () => {
    const s = await setup();
    const loss = s.platform.addTopic({ slug: 'loss' });
    const a = await s.signIn('Asha'); const c = s.as(a.cookie);
    await c.put('/api/journal/reminder', { mode: 'tie', topicId: loss._id }).expect(422); // not following it yet
    const e = (await c.post('/api/enrolments', { topicId: loss._id, slots: ALL_DAYS('08:00'), timezone: 'Asia/Kolkata', endDate: '2026-12-19' }).expect(201)).body;
    await c.put('/api/journal/reminder', { mode: 'tie', topicId: loss._id }).expect(200);
    expect(s.platform.enrol.get(e.id)!.actions!.map((x) => x.title)).toEqual(['Helpful', 'Journal on this']);
    await c.put('/api/journal/reminder', { mode: 'off' }).expect(200);
    expect(s.platform.enrol.get(e.id)!.actions).toBeNull();
  });
  it('admins see counts and dates only; deleting the account deletes the journal', async () => {
    const s = await setup({ adminOwnerEmail: 'owner@dev.invalid' });
    const owner = s.as((await s.signIn('Owner')).cookie);
    const a = await s.signIn('Asha');
    s.platform.deliveries.set('d1', { externalId: a.id, body: 'Q', attribution: null, topic: 'Loss' });
    await s.as(a.cookie).post('/api/journal', { text: 'Private words', mood: 3, deliveryId: 'd1' }).expect(201);
    const stats = (await owner.get('/api/admin/journal-stats').expect(200)).body;
    expect(stats).toMatchObject({ total: 1, last30Days: 1, writers30d: 1, withQuote30d: 1, withMood30d: 1, perDay: { '2026-11-20': 1 } });
    expect(JSON.stringify(stats)).not.toContain('Private');
    expect(JSON.stringify((await owner.get(`/api/admin/users/${a.id}`).expect(200)).body)).not.toContain('Private');
    await s.as(a.cookie).del('/auth/me').expect(204);
    expect(await s.ctx.store.journal.count({})).toBe(0);
    void W;
  });
});
