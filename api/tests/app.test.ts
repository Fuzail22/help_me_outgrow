import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp, type Deps } from '../src/app.js';
import { createFileUserStore } from '../src/users.js';

const ORIGIN = 'https://app.example.test';
function make(over: Partial<Deps['config']> = {}) {
  const exchanged: string[] = [];
  const users = createFileUserStore();
  const app = createApp({
    users,
    verifyGoogle: async (c) => { if (c !== 'valid-google-credential-token') throw new Error('bad'); return { googleId: 'g-123', email: 'asha@example.test', name: 'Asha' }; },
    platformToken: async (externalId) => { exchanged.push(externalId); return { token: 'platform.jwt.token', expiresIn: 3600 }; },
    config: { sessionSecret: 's'.repeat(40), appOrigin: ORIGIN, devLogin: false, secureCookies: true, ...over },
  });
  return { app, users, exchanged };
}
const signIn = async (app: any) => {
  const r = await request(app).post('/auth/google').set('origin', ORIGIN).send({ credential: 'valid-google-credential-token' }).expect(200);
  return { cookie: r.headers['set-cookie'][0].split(';')[0], user: r.body.user, raw: r.headers['set-cookie'][0] as string };
};

describe('thin backend', () => {
  it('signs in with a verified Google credential and sets an httpOnly, SameSite=Lax, Secure session cookie', async () => {
    const { app } = make();
    const s = await signIn(app);
    expect(s.user).toMatchObject({ name: 'Asha', email: 'asha@example.test' });
    expect(s.raw).toMatch(/HttpOnly/); expect(s.raw).toMatch(/SameSite=Lax/); expect(s.raw).toMatch(/Secure/);
    const me = await request(app).get('/auth/me').set('cookie', s.cookie).expect(200);
    expect(me.body.user.id).toBe(s.user.id);
  });
  it('rejects an unverifiable credential and keeps one account per Google id', async () => {
    const { app } = make();
    await request(app).post('/auth/google').send({ credential: 'forged-google-credential-token' }).expect(401);
    const a = await signIn(app); const b = await signIn(app);
    expect(a.user.id).toBe(b.user.id);
  });
  it('exchanges the session for a platform token using only the opaque user id', async () => {
    const { app, exchanged } = make();
    await request(app).post('/auth/platform-token').expect(401);
    const s = await signIn(app);
    const r = await request(app).post('/auth/platform-token').set('cookie', s.cookie).set('origin', ORIGIN).expect(200);
    expect(r.body).toEqual({ token: 'platform.jwt.token', expiresIn: 3600 });
    expect(exchanged).toEqual([s.user.id]);
    expect(exchanged[0]).not.toContain('asha'); expect(exchanged[0]).not.toContain('g-123');
  });
  it('refuses state-changing requests from another origin', async () => {
    const { app } = make(); const s = await signIn(app);
    await request(app).post('/auth/platform-token').set('cookie', s.cookie).set('origin', 'https://evil.example').expect(403);
  });
  it('offers the dev login only when enabled', async () => {
    await request(make().app).post('/auth/dev').send({ name: 'Demo' }).expect(404);
    const r = await request(make({ devLogin: true }).app).post('/auth/dev').send({ name: 'Demo User' }).expect(200);
    expect(r.body.user).toMatchObject({ name: 'Demo User', email: 'demo-user@dev.invalid' });
  });
  it('logs out, deletes the account, and rejects a tampered cookie', async () => {
    const { app, users } = make(); const s = await signIn(app);
    await request(app).get('/auth/me').set('cookie', s.cookie.slice(0, -3) + 'abc').expect(401);
    const out = await request(app).post('/auth/logout').set('cookie', s.cookie).expect(204);
    expect(out.headers['set-cookie'][0]).toMatch(/hmo_session=;/);
    await request(app).delete('/auth/me').set('cookie', s.cookie).set('origin', ORIGIN).expect(204);
    expect(await users.get(s.user.id)).toBeNull();
    await request(app).get('/auth/me').set('cookie', s.cookie).expect(401);
  });
});
