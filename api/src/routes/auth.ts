import type { Router } from 'express';
import { z } from 'zod';
import type { Ctx } from '../context.js';
import { h, HttpError, parse } from '../http.js';
import { COOKIE, sessionUser, setSession } from '../session.js';
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
