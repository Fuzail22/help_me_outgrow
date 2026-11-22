import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { Ctx } from './context.js';
import { HttpError } from './http.js';
import { normaliseUser } from './users.js';
import type { User } from './store/schema.js';

export const COOKIE = 'hmo_session';
export const SESSION_DAYS = 30;

export function setSession(ctx: Ctx, res: Response, userId: string) {
  const token = jwt.sign({ uid: userId }, ctx.config.sessionSecret, { algorithm: 'HS256', expiresIn: `${SESSION_DAYS}d` });
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: ctx.config.secureCookies, maxAge: SESSION_DAYS * 86400000, path: '/' });
}
export const readCookie = (req: Request, name: string) => {
  const m = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(req.header('cookie') ?? '');
  return m ? decodeURIComponent(m[1]) : null;
};
export async function sessionUser(ctx: Ctx, req: Request): Promise<User> {
  const raw = readCookie(req, COOKIE);
  if (!raw) throw new HttpError(401, 'not_signed_in', 'Sign in first');
  let uid: string;
  try { uid = (jwt.verify(raw, ctx.config.sessionSecret, { algorithms: ['HS256'] }) as any).uid; } catch { throw new HttpError(401, 'not_signed_in', 'Session expired'); }
  const user = await ctx.store.users.findOne({ _id: uid });
  if (!user) throw new HttpError(401, 'not_signed_in', 'Account not found');
  return normaliseUser(ctx, user);
}
