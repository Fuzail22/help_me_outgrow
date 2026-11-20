import type { Router } from 'express';
import { z } from 'zod';
import type { Ctx } from '../context.js';
import { h, HttpError, parse } from '../http.js';
import { randomBytes } from 'node:crypto';
import { COOKIE, readCookie, sessionUser, setSession } from '../session.js';
import { authorizeUrl, packState, pkce, unpackState } from '../auth/zoho.js';
import { deleteUser, publicUser, signInUser } from '../users.js';

/** Extra context sent with every sign-in: the browser's random device id and a referral code it arrived with. */
export const arrival = { deviceId: z.string().regex(/^[a-zA-Z0-9_-]{8,64}$/).nullish(), ref: z.string().regex(/^[a-z0-9]{4,16}$/).nullish() };

export function authRoutes(ctx: Ctx, api: Router) {
  api.get('/auth/healthz', (_req, res) => res.json({ ok: true }));
  api.get('/auth/config', (_req, res) => res.json({ google: !!ctx.config.googleClientId, zoho: !!(ctx.config.zoho.clientId && ctx.config.zoho.clientSecret), dev: ctx.config.devLogin }));

  api.post('/auth/google', h(async (req, res) => {
    const body = parse(z.object({ credential: z.string().min(20), ...arrival }), req.body);
    let id;
    try { id = await ctx.verifyGoogle(body.credential); } catch { throw new HttpError(401, 'google_rejected', 'Google sign-in could not be verified'); }
    if (!id.emailVerified) throw new HttpError(401, 'google_rejected', 'This Google account has no verified email');
    const { user, created } = await signInUser(ctx, { provider: 'google', sub: id.sub, email: id.email, name: id.name, deviceId: body.deviceId, ref: body.ref });
    setSession(ctx, res, user._id);
    res.json({ user: publicUser(user), created });
  }));

  // Local development and automated tests only: sign in without Google.
  if (ctx.config.devLogin) {
    api.post('/auth/dev', h(async (req, res) => {
      const body = parse(z.object({ name: z.string().min(1).max(40), ...arrival }), req.body);
      const slug = body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const { user, created } = await signInUser(ctx, { provider: 'dev', sub: `dev:${slug}`, email: `${slug}@dev.invalid`, name: body.name, deviceId: body.deviceId, ref: body.ref });
      setSession(ctx, res, user._id);
      res.json({ user: publicUser(user), created });
    }));
  }

  // Zoho: redirect out and back. State, nonce, PKCE verifier, where to return and the arrival context ride in a signed,
  // short-lived Lax cookie (it has to survive the top-level return from Zoho).
  const ZOHO = 'hmo_zoho';
  const redirectUri = () => `${ctx.config.publicUrl}/auth/zoho/callback`;
  const zohoCookie = (value: string, maxAge: number) => [`${ZOHO}=${value}`, 'Path=/auth/zoho', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`, ...(ctx.config.secureCookies ? ['Secure'] : [])].join('; ');
  /** Only paths on our own app: never an open redirect. */
  const safeNext = (n: unknown) => (typeof n === 'string' && /^\/(?!\/)[\w\-./?=&%]*$/.test(n) ? n : '/manage');
  api.get('/auth/zoho/start', h(async (req, res) => {
    if (!ctx.config.zoho.clientId || !ctx.config.zoho.clientSecret) throw new HttpError(503, 'zoho_not_configured', 'Zoho sign-in is not configured');
    const q = parse(z.object({ next: z.string().optional(), ...arrival }), req.query);
    const { verifier, challenge } = pkce();
    const state = randomBytes(16).toString('base64url'); const nonce = randomBytes(16).toString('base64url');
    const packed = packState(ctx.config.sessionSecret, { state, nonce, verifier, next: safeNext(q.next), exp: Math.floor(ctx.now().getTime() / 1000) + 600, deviceId: q.deviceId ?? null, ref: q.ref ?? null } as any);
    res.setHeader('set-cookie', zohoCookie(packed, 600));
    res.redirect(302, authorizeUrl({ ...ctx.config.zoho, redirectUri: redirectUri() }, { state, nonce, challenge }));
  }));
  api.get('/auth/zoho/callback', h(async (req, res) => {
    const back = (path: string) => `${ctx.config.appOrigin}${path}`;
    const fail = (code: string) => { res.setHeader('set-cookie', zohoCookie('', 0)); res.redirect(302, back(`/signin?error=${encodeURIComponent(code)}`)); };
    const saved = unpackState(ctx.config.sessionSecret, readCookie(req, ZOHO) ?? undefined, ctx.now().getTime()) as (ReturnType<typeof unpackState> & { deviceId: string | null; ref: string | null }) | null;
    const q = req.query as Record<string, string | undefined>;
    if (!saved || !q.state || q.state !== saved.state) return fail('state');
    if (q.error || !q.code) return fail(q.error ?? 'cancelled');
    let id;
    try { id = await ctx.zohoSignIn({ code: q.code, verifier: saved.verifier, nonce: saved.nonce, server: q['accounts-server'] ?? null, redirectUri: redirectUri() }); } catch (e) { return fail(e instanceof HttpError ? e.code : 'zoho_rejected'); }
    if (!id.emailVerified) return fail('email_unverified');
    const { user } = await signInUser(ctx, { provider: 'zoho', sub: id.sub, email: id.email, name: id.name, deviceId: saved.deviceId, ref: saved.ref });
    setSession(ctx, res, user._id);
    res.append('set-cookie', zohoCookie('', 0));
    res.redirect(302, back(saved.next));
  }));

  api.get('/auth/me', h(async (req, res) => res.json({ user: publicUser(await sessionUser(ctx, req)) })));
  api.post('/auth/logout', (_req, res) => { res.clearCookie(COOKIE, { path: '/' }); res.status(204).end(); });

  /** The browser SDK calls this for a short-lived platform token. The platform only ever sees our opaque user id. */
  api.post('/auth/platform-token', h(async (req, res) => {
    const user = await sessionUser(ctx, req);
    res.json(await ctx.platform.token(user._id));
  }));

  /** Deletes the account here. The browser erases the platform side first, with its subscriber token. */
  api.delete('/auth/me', h(async (req, res) => {
    const user = await sessionUser(ctx, req);
    await deleteUser(ctx, user._id);
    res.clearCookie(COOKIE, { path: '/' });
    res.status(204).end();
  }));
}
