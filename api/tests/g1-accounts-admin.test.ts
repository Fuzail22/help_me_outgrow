import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { ORIGIN, setup } from './helpers.js';

const W = { 'x-admin': '1' };

describe('G1: Zoho sign-in for app users', () => {
  it('redirects to Zoho with PKCE and comes back signed in, to the page asked for', async () => {
    const s = await setup();
    const start = await request(s.app).get('/auth/zoho/start?next=/growth&deviceId=device-abc-123').expect(302);
    const loc = new URL(start.headers.location);
    expect(loc.origin + loc.pathname).toBe('https://accounts.zoho.in/oauth/v2/auth');
    expect(loc.searchParams.get('redirect_uri')).toBe('https://api.example.test/auth/zoho/callback');
    const cookie = String(start.headers['set-cookie']).split(';')[0];
    s.ctx.zohoSignIn = async (i) => { expect(i.nonce).toBe(loc.searchParams.get('nonce')); return { sub: 'z-1', email: 'Ravi@Example.test', name: 'Ravi', emailVerified: true }; };
    const cb = await request(s.app).get(`/auth/zoho/callback?code=c&state=${loc.searchParams.get('state')}`).set('cookie', cookie).expect(302);
    expect(cb.headers.location).toBe(`${ORIGIN}/growth`);
    const session = (cb.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('hmo_session='))!.split(';')[0];
    const me = (await request(s.app).get('/auth/me').set('cookie', session).expect(200)).body.user;
    expect(me).toMatchObject({ email: 'ravi@example.test', name: 'Ravi' });
    expect((await s.ctx.store.users.findOne({ _id: me.id }))!.deviceIds).toEqual(['device-abc-123']);
  });
  it('the same verified email through Google and Zoho is one account', async () => {
    const s = await setup();
    const g = (await request(s.app).post('/auth/google').set('origin', ORIGIN).send({ credential: 'valid-google-credential-token' }).expect(200)).body.user;
    const start = await request(s.app).get('/auth/zoho/start').expect(302);
    const state = new URL(start.headers.location).searchParams.get('state');
    s.ctx.zohoSignIn = async () => ({ sub: 'z-9', email: 'asha@example.test', name: 'Asha', emailVerified: true });
    await request(s.app).get(`/auth/zoho/callback?code=c&state=${state}`).set('cookie', String(start.headers['set-cookie']).split(';')[0]).expect(302);
    const u = await s.ctx.store.users.find({});
    expect(u).toHaveLength(1);
    expect(u[0]).toMatchObject({ _id: g.id, providers: { google: 'g-123', zoho: 'z-9' } });
  });
  it('never redirects off the app, and refuses a wrong state or an unverified email', async () => {
    const s = await setup();
    for (const next of ['https://evil.example', '//evil.example', '/\\evil']) {
      const start = await request(s.app).get(`/auth/zoho/start?next=${encodeURIComponent(next)}`).expect(302);
      const state = new URL(start.headers.location).searchParams.get('state');
      s.ctx.zohoSignIn = async () => ({ sub: 'z', email: 'x@example.test', name: 'X', emailVerified: true });
      const cb = await request(s.app).get(`/auth/zoho/callback?code=c&state=${state}`).set('cookie', String(start.headers['set-cookie']).split(';')[0]).expect(302);
      expect(cb.headers.location).toBe(`${ORIGIN}/manage`);
    }
    const start = await request(s.app).get('/auth/zoho/start').expect(302);
    const cookie = String(start.headers['set-cookie']).split(';')[0];
    expect((await request(s.app).get('/auth/zoho/callback?code=c&state=nope').set('cookie', cookie).expect(302)).headers.location).toBe(`${ORIGIN}/signin?error=state`);
    s.ctx.zohoSignIn = async () => ({ sub: 'z2', email: 'y@example.test', name: 'Y', emailVerified: false });
    const r = await request(s.app).get(`/auth/zoho/callback?code=c&state=${new URL(start.headers.location).searchParams.get('state')}`).set('cookie', cookie).expect(302);
    expect(r.headers.location).toBe(`${ORIGIN}/signin?error=email_unverified`);
  });
  it('is off when not configured', async () => {
    const s = await setup({ zoho: { clientId: null, clientSecret: null, accountsUrl: 'https://accounts.zoho.in' } });
    await request(s.app).get('/auth/zoho/start').expect(503);
    expect((await request(s.app).get('/auth/config').expect(200)).body).toEqual({ google: true, zoho: false, dev: true });
  });
});

describe('G1: admin roles and audit', () => {
  async function admins() {
    const s = await setup({ adminOwnerEmail: 'owner@dev.invalid' });
    const owner = s.as((await s.signIn('Owner')).cookie);
    const invite = async (name: string, role: string) => { await owner.post('/api/admin/admins', { email: `${name.toLowerCase()}@dev.invalid`, role }).set(W).expect(201); return s.as((await s.signIn(name)).cookie); };
    return { s, owner, invite };
  }
  it('the configured owner is an owner at first sign-in; others are refused until invited', async () => {
    const { s, owner } = await admins();
    expect((await owner.get('/api/admin/me').expect(200)).body).toMatchObject({ email: 'owner@dev.invalid', role: 'owner' });
    const stranger = s.as((await s.signIn('Stranger')).cookie);
    expect((await stranger.get('/api/admin/me').expect(403)).body.error.code).toBe('not_admin');
    await request(s.app).get('/api/admin/me').expect(401);
  });
  it('enforces each role on the server, and writes need x-admin', async () => {
    const { s, owner, invite } = await admins();
    const editor = await invite('Ed', 'editor'); const support = await invite('Sup', 'support'); const viewer = await invite('View', 'viewer');
    const u = await s.signIn('Someone');
    const matrix: [string, (c: any) => any, string][] = [
      ['overview', (c) => c.get('/api/admin/overview'), 'viewer'],
      ['read settings', (c) => c.get('/api/admin/settings/growth'), 'viewer'],
      ['find people', (c) => c.get('/api/admin/users?q=someone'), 'support'],
      ['change limits', (c) => c.put('/api/admin/settings/limits', {}).set(W), 'editor'],
      ['grant', (c) => c.post(`/api/admin/users/${u.id}/entitlements`, {}).set(W), 'owner'],
      ['admins', (c) => c.get('/api/admin/admins'), 'owner'],
      ['audit', (c) => c.get('/api/admin/audit'), 'owner'],
    ];
    const rank = { viewer: 1, support: 2, editor: 3, owner: 4 } as const;
    for (const [name, call, min] of matrix) {
      for (const [who, c, r] of [['viewer', viewer, 1], ['support', support, 2], ['editor', editor, 3], ['owner', owner, 4]] as const) {
        const status = (await call(c)).status;
        if (r < rank[min as keyof typeof rank]) expect(status, `${who} ${name}`).toBe(403); else expect(status, `${who} ${name}`).not.toBe(403);
      }
    }
    expect((await owner.post('/api/admin/admins', { email: 'x@dev.invalid', role: 'viewer' }).expect(403)).body.error.code).toBe('csrf');
    // Pricing is for owners only.
    const pricing = (await owner.get('/api/admin/settings/pricing').expect(200)).body.data;
    await editor.put('/api/admin/settings/pricing', pricing).set(W).expect(403);
    await owner.put('/api/admin/settings/pricing', pricing).set(W).expect(200);
  });
  it('there is always one owner; a removed admin loses access at once', async () => {
    const { owner, invite } = await admins();
    const list = (await owner.get('/api/admin/admins').expect(200)).body.admins;
    const me = list.find((a: any) => a.email === 'owner@dev.invalid');
    expect((await owner.patch(`/api/admin/admins/${me._id}`, { role: 'viewer' }).set(W).expect(409)).body.error.code).toBe('last_owner');
    const ed = await invite('Ed', 'editor');
    const edId = (await owner.get('/api/admin/admins').expect(200)).body.admins.find((a: any) => a.email === 'ed@dev.invalid')._id;
    await ed.get('/api/admin/overview').expect(200);
    await owner.del(`/api/admin/admins/${edId}`).set(W).expect(204);
    await ed.get('/api/admin/overview').expect(403);
  });
  it('validates settings, refuses a duration over the platform ceiling, and audits every change', async () => {
    const { s, owner } = await admins();
    const limits = (await owner.get('/api/admin/settings/limits').expect(200)).body;
    expect(limits).toMatchObject({ isDefault: true, data: { baseItems: 90, maxDurationDays: 92 }, platform: { maxDurationDays: 366 } });
    expect((await owner.put('/api/admin/settings/limits', { ...limits.data, baseLadder: [{ minDays: 5, maxSlots: 3 }] }).set(W).expect(422)).body.error.code).toBe('invalid_settings');
    expect((await owner.put('/api/admin/settings/limits', { ...limits.data, maxDurationDays: 400 }).set(W).expect(422)).body.error.message).toMatch(/366/);
    await owner.put('/api/admin/settings/limits', { ...limits.data, baseItems: 99 }).set(W).expect(200);
    await owner.put('/api/admin/settings/limits', { ...limits.data, baseItems: 100 }).set(W).expect(200); // a second save updates
    const growth = (await owner.get('/api/admin/settings/growth').expect(200)).body.data;
    await owner.put('/api/admin/settings/growth', { ...growth, levels: [...growth.levels, { level: 3, mode: 'all', tasks: [{ type: 'referral_signups', count: 3 }] }] }).set(W).expect(200);
    const log = (await owner.get('/api/admin/audit').expect(200)).body.entries;
    expect(log.map((e: any) => e.action)).toEqual(['settings.growth', 'settings.limits', 'settings.limits']);
    expect(log[1]).toMatchObject({ actor: 'owner@dev.invalid', before: { baseItems: 99 }, after: { baseItems: 100 } });
    const u = await s.signIn('Person');
    const loss = s.platform.addTopic({ slug: 'loss' });
    expect((await s.as(u.cookie).get('/api/me/limits').expect(200)).body.perTopic[loss._id].maxItems).toBe(100);
  });
  it('an owner grants and revokes an entitlement by hand; the person’s limits follow; journal text is never shown', async () => {
    const { s, owner } = await admins();
    const loss = s.platform.addTopic({ slug: 'loss' });
    const u = await s.signIn('Person');
    const ent = (await owner.post(`/api/admin/users/${u.id}/entitlements`, { kind: 'slots', topicId: loss._id, amount: 2, months: null, note: 'Approved post bonus' }).set(W).expect(201)).body;
    expect((await s.as(u.cookie).get('/api/me/limits').expect(200)).body.perTopic[loss._id].maxSlots).toBe(5);
    const detail = (await owner.get(`/api/admin/users/${u.id}`).expect(200)).body;
    expect(detail.entitlements[0]).toMatchObject({ source: 'admin', amount: 2, active: true });
    expect(detail).toHaveProperty('journalEntries', 0);
    await owner.del(`/api/admin/users/${u.id}/entitlements/${ent._id}`).set(W).expect(204);
    expect((await s.as(u.cookie).get('/api/me/limits').expect(200)).body.perTopic[loss._id].maxSlots).toBe(3);
  });
});
