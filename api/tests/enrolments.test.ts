import { describe, expect, it } from 'vitest';
import { ALL_DAYS, setup } from './helpers.js';
import { checkEnough, notesNeeded } from '../src/limits.js';
import { newId } from '../src/ids.js';

const body = (topicId: string, extra: object = {}) => ({ topicId, slots: ALL_DAYS('08:00'), timezone: 'Asia/Kolkata', endDate: '2026-12-19', ...extra });

describe('G0: limits are decided here, then sent to the platform', () => {
  it('starts at 3 times a day, 90 quotes and 92 days; lists only public, unretired topics', async () => {
    const s = await setup();
    const loss = s.platform.addTopic({ slug: 'loss' });
    s.platform.addTopic({ slug: 'hidden', visibility: 'private' });
    s.platform.addTopic({ slug: 'old', retiredAt: '2026-01-01T00:00:00Z' });
    s.platform.addTopic({ slug: 'journal-prompts', visibility: 'private' });
    const a = await s.signIn();
    const r = (await s.as(a.cookie).get('/api/me/limits').expect(200)).body;
    expect(r.topics.map((t: any) => t.slug)).toEqual(['loss']);
    expect(r.perTopic[loss._id]).toMatchObject({ maxSlots: 3, maxItems: 90, itemsAvailable: 92 });
    expect(r).toMatchObject({ maxDurationDays: 92, platform: { maxPerDay: 24, minGapMinutes: 15 } });
  });
  it('creates through the platform with maxItems, then sets the "about to end" notice with a link to the next page', async () => {
    const s = await setup();
    const loss = s.platform.addTopic({ slug: 'loss' });
    const a = await s.signIn();
    const e = (await s.as(a.cookie).post('/api/enrolments', body(loss._id)).expect(201)).body;
    expect(s.platform.calls[0]).toMatchObject({ method: 'createEnrolment', args: [a.id, { topicId: loss._id, maxItems: 90, startDate: '2026-11-20', loop: null, actions: null }] });
    expect(e.endingNotice).toEqual({ withinDays: 3, text: "Notifications are about to end, choose what's next — {daysLeft} days left",
      action: { id: 'next', title: "Choose what's next", kind: 'open', url: `https://app.example.test/next/${e.id}` } });
  });
  it('refuses a fourth time a day, a private topic and more than 92 days', async () => {
    const s = await setup();
    const loss = s.platform.addTopic({ slug: 'loss' }); const hidden = s.platform.addTopic({ slug: 'hidden', visibility: 'private' });
    const a = await s.signIn(); const c = s.as(a.cookie);
    const four = ['07:00', '10:00', '13:00', '16:00'].flatMap(ALL_DAYS);
    expect((await c.post('/api/enrolments', body(loss._id, { slots: four, endDate: '2026-11-30' })).expect(422)).body.error).toMatchObject({ code: 'too_many_slots', details: { max: 3 } });
    await c.post('/api/enrolments', body(hidden._id)).expect(404);
    expect((await c.post('/api/enrolments', body(loss._id, { endDate: '2027-02-20', loop: true })).expect(422)).body.error.code).toBe('invalid_duration');
    expect(s.platform.calls).toEqual([]);
  });
  it('adds entitlements: a level pick (largest wins), purchases and admin grants; capped by the platform', async () => {
    const s = await setup();
    const loss = s.platform.addTopic({ slug: 'loss' });
    const a = await s.signIn();
    const ent = (o: object) => s.ctx.store.entitlements.insertOne({ _id: newId(), userId: a.id, topicId: loss._id, startsAt: s.clock.now(), expiresAt: null, revokedAt: null, sourceRef: 'x', ...o } as any);
    await ent({ kind: 'slots', amount: 1, source: 'level' }); await ent({ kind: 'slots', amount: 2, source: 'level' });
    await ent({ kind: 'slots', amount: 1, source: 'purchase', expiresAt: new Date('2027-11-20') });
    await ent({ kind: 'slots', amount: 5, source: 'purchase', expiresAt: new Date('2026-11-19') }); // expired
    await ent({ kind: 'items', amount: 3, source: 'level' }); await ent({ kind: 'items', amount: 20, source: 'purchase', expiresAt: null });
    const lim = (await s.as(a.cookie).get('/api/me/limits').expect(200)).body.perTopic[loss._id];
    expect(lim).toMatchObject({ maxSlots: 3 + 2 + 1, maxItems: 90 + 3 + 20, parts: { base: 3, levelSlots: 2, paidSlots: 1, levelItems: 3, paidItems: 20 } });
    s.platform.policyValue.maxPerDay = 4;
    expect((await s.as(a.cookie).get('/api/me/limits').expect(200)).body.perTopic[loss._id].maxSlots).toBe(4);
  });
  it('the account-age ladder still applies: 6 after 30 days', async () => {
    const s = await setup();
    const loss = s.platform.addTopic({ slug: 'loss' });
    const a = await s.signIn();
    s.clock.advanceDays(30);
    expect((await s.as(a.cookie).get('/api/me/limits').expect(200)).body.perTopic[loss._id].maxSlots).toBe(6);
  });
});

describe('G6: enough quotes, and what happens next', () => {
  it('counts the notes a schedule needs and offers three ways out when the topic is too short', () => {
    expect(notesNeeded(ALL_DAYS('08:00'), '2026-11-20', '2026-11-26')).toBe(7);
    expect(notesNeeded([{ day: 1, time: '08:00' }, { day: 1, time: '20:00' }], '2026-11-16', '2026-11-30')).toBe(6); // three Mondays
    try { checkEnough({ slots: [...ALL_DAYS('08:00'), ...ALL_DAYS('20:00')], startDate: '2026-11-20', endDate: '2026-12-19' }, 20); throw new Error('no'); } catch (e: any) {
      expect(e.code).toBe('not_enough_quotes');
      expect(e.details).toMatchObject({ needed: 60, available: 20, options: { endDate: '2026-11-29', timesPerDay: null, loop: true } });
    }
  });
  it('refuses a schedule longer than the topic unless it loops', async () => {
    const s = await setup();
    const short = s.platform.addTopic({ slug: 'short' }, 10);
    const a = await s.signIn(); const c = s.as(a.cookie);
    expect((await c.post('/api/enrolments', body(short._id)).expect(422)).body.error).toMatchObject({ code: 'not_enough_quotes', details: { needed: 30, available: 10 } });
    await c.post('/api/enrolments', body(short._id, { loop: true })).expect(201);
  });
  it('next: loop again starts the same topic from the first line with the same times; new course switches topic', async () => {
    const s = await setup();
    const loss = s.platform.addTopic({ slug: 'loss' }); const burnt = s.platform.addTopic({ slug: 'burnt-out' });
    const a = await s.signIn(); const c = s.as(a.cookie);
    const e = (await c.post('/api/enrolments', body(loss._id, { endDate: '2026-12-19' })).expect(201)).body;
    s.clock.set('2026-12-17T06:00:00Z');
    const looped = (await c.post(`/api/enrolments/${e.id}/next`, { choice: 'loop' }).expect(201)).body;
    expect(looped).toMatchObject({ topicId: loss._id, loop: true, startDate: '2026-12-17', endDate: '2027-01-15', slots: e.slots });
    expect(s.platform.enrol.get(e.id)!.status).toBe('cancelled');
    const next = (await c.post(`/api/enrolments/${looped.id}/next`, { choice: 'new', topicId: burnt._id }).expect(201)).body;
    expect(next).toMatchObject({ topicId: burnt._id, loop: null });
    // A refused new course leaves the old one running.
    const before = s.platform.enrol.get(next.id)!.status;
    await c.post(`/api/enrolments/${next.id}/next`, { choice: 'new', topicId: 'nope' }).expect(404);
    expect(s.platform.enrol.get(next.id)!.status).toBe(before);
  });
  it('next: extend needs more quotes unlocked first, then raises maxItems on the running course', async () => {
    const s = await setup();
    const loss = s.platform.addTopic({ slug: 'loss' }, 200);
    const a = await s.signIn(); const c = s.as(a.cookie);
    const e = (await c.post('/api/enrolments', body(loss._id)).expect(201)).body;
    expect((await c.post(`/api/enrolments/${e.id}/next`, { choice: 'extend' }).expect(409)).body.error.code).toBe('nothing_to_extend');
    await s.ctx.store.entitlements.insertOne({ _id: newId(), userId: a.id, kind: 'items', topicId: loss._id, amount: 3, source: 'level', sourceRef: 'L1', startsAt: s.clock.now(), expiresAt: null, revokedAt: null });
    const r = (await c.post(`/api/enrolments/${e.id}/next`, { choice: 'extend' }).expect(200)).body;
    expect(r.maxItems).toBe(93);
  });
  it('someone else’s enrolment is not found', async () => {
    const s = await setup();
    const loss = s.platform.addTopic({ slug: 'loss' });
    const a = await s.signIn('A'); const b = await s.signIn('B');
    const e = (await s.as(a.cookie).post('/api/enrolments', body(loss._id)).expect(201)).body;
    await s.as(b.cookie).patch(`/api/enrolments/${e.id}`, { action: 'cancel' }).expect(404);
    await s.as(b.cookie).post(`/api/enrolments/${e.id}/next`, { choice: 'loop' }).expect(404);
  });
});

describe('accounts', () => {
  it('reads a 0.5 user document and brings it to the current shape on first use', async () => {
    const s = await setup();
    await s.ctx.store.users.insertOne({ _id: 'u_old', id: 'u_old', googleId: 'g-123', email: 'asha@example.test', name: 'Asha', createdAt: '2026-10-01T00:00:00.000Z' } as any);
    const r = await (await import('supertest')).default(s.app).post('/auth/google').set('origin', 'https://app.example.test').send({ credential: 'valid-google-credential-token' }).expect(200);
    expect(r.body).toMatchObject({ user: { id: 'u_old' }, created: false });
    const u = await s.ctx.store.users.findOne({ _id: 'u_old' });
    expect(u).toMatchObject({ providers: { google: 'g-123' }, deviceIds: [] });
    expect(u!.createdAt).toBeInstanceOf(Date);
    expect(u!.referralCode).toMatch(/^[a-z2-9]{8}$/);
  });
});
