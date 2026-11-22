import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { ALL_DAYS, ORIGIN, setup } from './helpers.js';
import { forgetRatings } from '../src/growth.js';
import { checkText } from '../src/content.js';

const W = { 'x-admin': '1' };
const visit = (s: Awaited<ReturnType<typeof setup>>, code: string, deviceId: string, cookie?: string) => {
  const r = request(s.app).post('/api/ref/visit').set('origin', ORIGIN).send({ code, deviceId });
  return cookie ? r.set('cookie', cookie) : r;
};

describe('G3: referral links', () => {
  it('a visit counts once per device, never from the owner’s own devices or session', async () => {
    const s = await setup();
    const a = await s.signIn('Asha', { deviceId: 'asha-phone-0001' });
    const code = a.user.referralCode as string;
    expect((await visit(s, code, 'asha-phone-0001').expect(200)).body.counted).toBe(false);
    expect((await visit(s, code, 'someone-else-01', a.cookie).expect(200)).body.counted).toBe(false);
    expect((await visit(s, code, 'friend-device-1').expect(200)).body.counted).toBe(true);
    expect((await visit(s, code, 'friend-device-1').expect(200)).body.counted).toBe(false);
    expect((await visit(s, 'nosuchcode', 'friend-device-2').expect(200)).body.counted).toBe(false);
    // Asha later signs in on the "friend" device: it was hers after all, so that visit no longer counts.
    await s.signIn('Asha', { deviceId: 'friend-device-1' });
    expect(await s.ctx.store.refVisits.count({ ownerId: a.id })).toBe(0);
  });
  it('a new account created through the link is a referred sign-up (not on the referrer’s device)', async () => {
    const s = await setup();
    const a = await s.signIn('Asha', { deviceId: 'asha-phone-0001' });
    await s.signIn('Bea', { deviceId: 'bea-phone-00001', ref: a.user.referralCode });
    await s.signIn('Carl', { deviceId: 'asha-phone-0001', ref: a.user.referralCode });
    const bea = await s.ctx.store.users.findOne({ name: 'Bea' }); const carl = await s.ctx.store.users.findOne({ name: 'Carl' });
    expect(bea!.referredBy).toMatchObject({ userId: a.id });
    expect(carl!.referredBy).toBeNull();
    // An existing account signing in with a ref is not a new referral.
    await s.signIn('Bea', { deviceId: 'bea-phone-00001', ref: 'zzzzzzzz' });
    expect((await s.ctx.store.users.findOne({ name: 'Bea' }))!.referredBy).toMatchObject({ userId: a.id });
  });
  it('rate-limits visits per IP', async () => {
    const s = await setup();
    const a = await s.signIn('Asha');
    let last = 200;
    for (let i = 0; i < 31; i++) last = (await visit(s, a.user.referralCode, `device-rate-${String(i).padStart(4, '0')}`)).status;
    expect(last).toBe(429);
  });
});

describe('G2: levels from numbers, celebration, one pick per level', () => {
  it('L1 by 9 ratings (helpful or not) or 1 referral visit; L2 by a referred sign-up or 10 visits', async () => {
    const s = await setup();
    s.platform.addTopic({ slug: 'loss' });
    const a = await s.signIn('Asha'); const c = s.as(a.cookie);
    let g = (await c.get('/api/growth').expect(200)).body;
    expect(g).toMatchObject({ level: 0, celebrate: [], referral: { url: `${ORIGIN}/r/${a.user.referralCode}` } });
    expect(g.levels[0].tasks).toEqual([{ type: 'ratings', count: 9, have: 0 }, { type: 'referral_visits', count: 1, have: 0 }]);
    s.platform.summaries.set(a.id, { delivered: 12, opened: 3, rated: 9, ratedUp: 4, ratedDown: 5, lastRatedAt: null, byTopic: {} });
    forgetRatings(a.id);
    g = (await c.get('/api/growth').expect(200)).body;
    expect(g).toMatchObject({ level: 1, celebrate: [1] });
    expect(g.levels[0]).toMatchObject({ reached: true, options: [{ vavp: 'vavp1', amount: 1 }, { vavp: 'vavp2', amount: 3 }] });
    await c.post('/api/growth/celebrated', { levels: [1] }).expect(204);
    expect((await c.get('/api/growth').expect(200)).body.celebrate).toEqual([]);
    await s.signIn('Bea', { deviceId: 'bea-phone-00001', ref: a.user.referralCode });
    expect((await c.get('/api/growth').expect(200)).body).toMatchObject({ level: 2, celebrate: [2] });
  });
  it('a level is never taken back, and levels unlock in order', async () => {
    const s = await setup();
    const a = await s.signIn('Asha'); const c = s.as(a.cookie);
    // A referred sign-up alone satisfies L2's task, but L1 is not reached: nothing unlocks.
    const owner = s.as((await s.signIn('Owner')).cookie);
    s.ctx.config.adminOwnerEmail = 'owner@dev.invalid';
    const growth = (await owner.get('/api/admin/settings/growth').expect(200)).body.data;
    await owner.put('/api/admin/settings/growth', { ...growth, levels: [{ level: 1, mode: 'any', tasks: [{ type: 'ratings', count: 9 }] }, growth.levels[1]] }).set(W).expect(200);
    await s.signIn('Bea', { deviceId: 'bea-device-0001', ref: a.user.referralCode });
    expect((await c.get('/api/growth').expect(200)).body.level).toBe(0);
    s.platform.summaries.set(a.id, { delivered: 9, opened: 0, rated: 9, ratedUp: 9, ratedDown: 0, lastRatedAt: null, byTopic: {} }); forgetRatings(a.id);
    expect((await c.get('/api/growth').expect(200)).body.level).toBe(2);
    s.platform.summaries.set(a.id, { delivered: 0, opened: 0, rated: 0, ratedUp: 0, ratedDown: 0, lastRatedAt: null, byTopic: {} }); forgetRatings(a.id);
    expect((await c.get('/api/growth').expect(200)).body.level).toBe(2);
  });
  it('VAVP1 pick: +1 a day on the chosen topic; VAVP2 pick raises quotes on running courses; one pick per level', async () => {
    const s = await setup();
    const loss = s.platform.addTopic({ slug: 'loss' }, 200);
    const a = await s.signIn('Asha'); const c = s.as(a.cookie);
    const e = (await c.post('/api/enrolments', { topicId: loss._id, slots: ALL_DAYS('08:00'), timezone: 'Asia/Kolkata', endDate: '2026-12-19' }).expect(201)).body;
    await c.post('/api/growth/pick', { level: 1, vavp: 'vavp1', topicId: loss._id }).expect(409); // not reached
    await visit(s, a.user.referralCode, 'friend-device-1').expect(200);
    await c.post('/api/growth/pick', { level: 1, vavp: 'vavp3' }).expect(422); // not offered at L1 by default
    await c.post('/api/growth/pick', { level: 1, vavp: 'vavp1', topicId: 'not-mine' }).expect(422);
    const g = (await c.post('/api/growth/pick', { level: 1, vavp: 'vavp1', topicId: loss._id }).expect(200)).body;
    expect(g.levels[0].pick).toMatchObject({ vavp: 'vavp1', topicId: loss._id, amount: 1 });
    expect((await c.get('/api/me/limits').expect(200)).body.perTopic[loss._id]).toMatchObject({ maxSlots: 4, parts: { levelSlots: 1 } });
    await c.post('/api/growth/pick', { level: 1, vavp: 'vavp2', topicId: loss._id }).expect(409);
    // Level 2 (10 visits) → VAVP2 +6 applies to the running course straight away.
    for (let i = 2; i <= 10; i++) await visit(s, a.user.referralCode, `friend-device-${i}`).expect(200);
    await c.post('/api/growth/pick', { level: 2, vavp: 'vavp2', topicId: loss._id }).expect(200);
    expect(s.platform.enrol.get(e.id)!.maxItems).toBe(96);
  });
  it('an approved social post counts as one referral visit; support reviews it once', async () => {
    const s = await setup({ adminOwnerEmail: 'owner@dev.invalid' });
    const owner = s.as((await s.signIn('Owner')).cookie);
    await owner.post('/api/admin/admins', { email: 'sup@dev.invalid', role: 'support' }).set(W).expect(201);
    const sup = s.as((await s.signIn('Sup')).cookie);
    const a = await s.signIn('Asha'); const c = s.as(a.cookie);
    const p = (await c.post('/api/growth/proofs', { note: 'Instagram story' }).expect(201)).body;
    const queue = (await sup.get('/api/admin/proofs').expect(200)).body.proofs;
    expect(queue).toEqual([expect.objectContaining({ _id: p.id, email: 'asha@dev.invalid', note: 'Instagram story' })]);
    await sup.post(`/api/admin/proofs/${p.id}/approve`).set(W).expect(200);
    await sup.post(`/api/admin/proofs/${p.id}/reject`).set(W).expect(409);
    const g = (await c.get('/api/growth').expect(200)).body;
    expect(g).toMatchObject({ level: 1, counts: { referral_visits: 1, approved_posts: 1 } });
    const viewerOnly = s.as((await s.signIn('Viewer')).cookie);
    await owner.post('/api/admin/admins', { email: 'viewer@dev.invalid', role: 'viewer' }).set(W).expect(201);
    await viewerOnly.get('/api/admin/proofs').expect(403);
  });
});

describe('G4: VAVP3 own topic', () => {
  async function withOwnTopic(visibility: 'private' | 'public' = 'private') {
    const s = await setup({ adminOwnerEmail: 'owner@dev.invalid' });
    const owner = s.as((await s.signIn('Owner')).cookie);
    const a = await s.signIn('Asha'); const c = s.as(a.cookie);
    await c.post('/api/own-topics', { title: 'My mornings', visibility }).expect(402);
    await owner.post(`/api/admin/users/${a.id}/entitlements`, { kind: 'own_topic', topicId: null, amount: 1, months: 12, note: 'test' }).set(W).expect(201);
    const t = (await c.post('/api/own-topics', { title: 'My mornings', description: 'Mine', visibility }).expect(201)).body;
    return { s, owner, a, c, t };
  }
  it('creates a private platform topic only the owner may follow, with up to 150 lines', async () => {
    const { s, c, t } = await withOwnTopic();
    expect(t).toMatchObject({ status: 'live', visibility: 'private', lineCap: 150 });
    expect(s.platform.calls.find((x) => x.method === 'createTopic')!.args[0]).toMatchObject({ visibility: 'private' });
    const add = (await c.post(`/api/own-topics/${t._id}/lines`, { lines: [{ body: 'Breathe before the day starts.' }, { body: 'URGENT: claim your prize now!!' }] }).expect(201)).body;
    expect(add.created[0].warnings).toEqual([]);
    expect(add.created[1].warnings.map((w: any) => w.id)).toEqual(expect.arrayContaining(['urgency', 'winning', 'shouting']));
    const many = Array.from({ length: 149 }, (_, i) => ({ body: `Line number ${i}` }));
    expect((await c.post(`/api/own-topics/${t._id}/lines`, { lines: many }).expect(422)).body.error).toMatchObject({ code: 'line_cap', details: { cap: 150, have: 2 } });
    const limits = (await c.get('/api/me/limits').expect(200)).body;
    expect(limits.topics.map((x: any) => x.id)).toContain(t.platformTopicId);
    const b = await s.signIn('Bea');
    expect((await s.as(b.cookie).get('/api/me/limits').expect(200)).body.topics.map((x: any) => x.id)).not.toContain(t.platformTopicId);
  });
  it('a public topic waits for an editor; approval publishes it on the platform', async () => {
    const { s, owner, t } = await withOwnTopic('public');
    expect(t.status).toBe('review');
    expect((await owner.get('/api/admin/own-topics').expect(200)).body.topics.map((x: any) => x._id)).toEqual([t._id]);
    await owner.post(`/api/admin/own-topics/${t._id}/approve`).set(W).expect(200);
    expect(s.platform.topicsList.find((x) => x._id === t.platformTopicId)!.visibility).toBe('public');
  });
  it('when the privilege ends the topic can no longer be edited or newly followed', async () => {
    const { s, c, t } = await withOwnTopic();
    s.clock.advanceDays(400);
    await c.get(`/api/own-topics/${t._id}/lines`).expect(403);
    expect((await c.get('/api/me/limits').expect(200)).body.topics.map((x: any) => x.id)).not.toContain(t.platformTopicId);
  });
});

describe('G8: content check', () => {
  it('flags scam-like wording and leaves ordinary encouragement alone', () => {
    expect(checkText('You are allowed to rest today. Small steps still count.')).toEqual([]);
    expect(checkText('Tap here to verify your account').map((w) => w.id)).toEqual(['clickbait', 'security']);
    expect(checkText('Win ₹500 cashback, visit www.example.com').map((w) => w.id)).toEqual(expect.arrayContaining(['money', 'link']));
  });
});
