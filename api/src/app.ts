import express, { type NextFunction, type Request, type Response } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import type { UserStore } from './users.js';

export interface GoogleProfile { googleId: string; email: string; name: string }
export interface Deps {
  users: UserStore;
  /** Verifies a Google ID token (audience = our client id) and returns the profile. Throws when invalid. */
  verifyGoogle: (credential: string) => Promise<GoogleProfile>;
  /** Exchanges our user id for a platform subscriber token. */
  platformToken: (externalId: string) => Promise<{ token: string; expiresIn: number }>;
  config: { sessionSecret: string; appOrigin: string; devLogin: boolean; secureCookies: boolean };
}

const COOKIE = 'hmo_session';
const SESSION_DAYS = 30;
const h = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => { fn(req, res).catch(next); };
class HttpError extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }

export function createApp(deps: Deps) {
  const { config } = deps;
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '16kb' }));

  // The app is served from another origin (outgrow.htsta.com) than this api (api.outgrow.htsta.com).
  // Same site, so the Lax cookie is sent; browsers still need explicit CORS permission for credentials.
  app.use((req, res, next) => {
    if (req.header('origin') === config.appOrigin) {
      res.set({ 'Access-Control-Allow-Origin': config.appOrigin, 'Access-Control-Allow-Credentials': 'true', Vary: 'Origin' });
      if (req.method === 'OPTIONS') {
        res.set({ 'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Max-Age': '600' });
        return res.status(204).end();
      }
    }
    next();
  });

  // The session cookie is SameSite=Lax; state-changing requests must also come from our own origin.
  app.use((req, _res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const origin = req.header('origin');
      if (origin && origin !== config.appOrigin) return next(new HttpError(403, 'bad_origin', 'Cross-site request refused'));
    }
    next();
  });

  const setSession = (res: Response, userId: string) => {
    const token = jwt.sign({ uid: userId }, config.sessionSecret, { algorithm: 'HS256', expiresIn: `${SESSION_DAYS}d` });
    res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: config.secureCookies, maxAge: SESSION_DAYS * 86400000, path: '/' });
  };
  const sessionUser = async (req: Request) => {
    const raw = /(?:^|;\s*)hmo_session=([^;]+)/.exec(req.header('cookie') ?? '')?.[1];
    if (!raw) throw new HttpError(401, 'not_signed_in', 'Sign in first');
    let uid: string;
    try { uid = (jwt.verify(raw, config.sessionSecret, { algorithms: ['HS256'] }) as any).uid; } catch { throw new HttpError(401, 'not_signed_in', 'Session expired'); }
    const user = await deps.users.get(uid);
    if (!user) throw new HttpError(401, 'not_signed_in', 'Account not found');
    return user;
  };
  const publicUser = (u: { id: string; name: string; email: string }) => ({ id: u.id, name: u.name, email: u.email });

  app.get('/auth/healthz', (_req, res) => res.json({ ok: true }));

  app.post('/auth/google', h(async (req, res) => {
    const { credential } = z.object({ credential: z.string().min(20) }).parse(req.body);
    let profile: GoogleProfile;
    try { profile = await deps.verifyGoogle(credential); } catch { throw new HttpError(401, 'google_rejected', 'Google sign-in could not be verified'); }
    const user = await deps.users.upsertByGoogleId(profile);
    setSession(res, user.id);
    res.json({ user: publicUser(user) });
  }));

  // Local development and automated tests only: sign in without Google.
  if (config.devLogin) {
    app.post('/auth/dev', h(async (req, res) => {
      const { name } = z.object({ name: z.string().min(1).max(40) }).parse(req.body);
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const user = await deps.users.upsertByGoogleId({ googleId: `dev:${slug}`, email: `${slug}@dev.invalid`, name });
      setSession(res, user.id);
      res.json({ user: publicUser(user) });
    }));
  }

  app.get('/auth/me', h(async (req, res) => res.json({ user: publicUser(await sessionUser(req)) })));
  app.post('/auth/logout', (_req, res) => { res.clearCookie(COOKIE, { path: '/' }); res.status(204).end(); });

  /** The browser SDK calls this for a short-lived platform token. The platform only ever sees our opaque user id. */
  app.post('/auth/platform-token', h(async (req, res) => {
    const user = await sessionUser(req);
    res.json(await deps.platformToken(user.id));
  }));

  /** Deletes the account here. The browser erases the platform side first, with its subscriber token. */
  app.delete('/auth/me', h(async (req, res) => {
    const user = await sessionUser(req);
    await deps.users.delete(user.id);
    res.clearCookie(COOKIE, { path: '/' });
    res.status(204).end();
  }));

  app.use((_req, res) => res.status(404).json({ error: { code: 'not_found', message: 'No such route' } }));
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: { code: err.code, message: err.message } });
    if (err instanceof z.ZodError) return res.status(422).json({ error: { code: 'validation_failed', message: 'Request body is invalid' } });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: { code: 'invalid_json', message: 'Body is not valid JSON' } });
    console.error(err);
    res.status(502).json({ error: { code: 'upstream_failed', message: 'Something went wrong; please try again' } });
  });
  return app;
}
