import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Ctx } from '../context.js';
import { HttpError } from '../http.js';
import { newId } from '../ids.js';
import { sessionUser } from '../session.js';
import type { AdminRole, AdminUser } from '../store/schema.js';

export const ROLES: AdminRole[] = ['owner', 'editor', 'support', 'viewer'];
export const ROLE_RANK: Record<AdminRole, number> = { viewer: 1, support: 2, editor: 3, owner: 4 };
export interface AdminAuth { email: string; role: AdminRole; userId: string }
export type AdminRequest = Request & { admin: AdminAuth };

/** ADMIN_OWNER_EMAIL becomes an owner the first time it signs in; a later change of role stands. */
async function ensureOwner(ctx: Ctx, email: string) {
  if (!ctx.config.adminOwnerEmail || email !== ctx.config.adminOwnerEmail) return;
  if (await ctx.store.admins.findOne({ email })) return;
  await ctx.store.admins.insertOne({ _id: newId('a_'), email, role: 'owner', invitedBy: null, createdAt: ctx.now(), lastSignInAt: null }).catch(() => undefined);
}

/**
 * Admins are ordinary signed-in people (Google or Zoho) whose verified email was invited. The role is re-read on every
 * request, so a removal or demotion is immediate. Writes need `x-admin: 1` as a second CSRF guard beside the Lax cookie.
 */
export const requireAdmin = (ctx: Ctx, min: AdminRole): RequestHandler => (req: Request, _res: Response, next: NextFunction) => {
  (async () => {
    if (req.method !== 'GET' && req.header('x-admin') !== '1') throw new HttpError(403, 'csrf', 'Missing x-admin header');
    const user = await sessionUser(ctx, req);
    const email = user.email.toLowerCase();
    await ensureOwner(ctx, email);
    const a: AdminUser | null = await ctx.store.admins.findOne({ email });
    if (!a) throw new HttpError(403, 'not_admin', 'This account is not an admin');
    if (ROLE_RANK[a.role] < ROLE_RANK[min]) throw new HttpError(403, 'forbidden', `This needs the ${min} role`);
    if (!a.lastSignInAt || ctx.now().getTime() - a.lastSignInAt.getTime() > 3600_000) await ctx.store.admins.updateOne({ _id: a._id }, { $set: { lastSignInAt: ctx.now() } });
    (req as AdminRequest).admin = { email, role: a.role, userId: user._id };
  })().then(() => next(), next);
};

export async function audit(ctx: Ctx, actor: string, action: string, target: string | null, before: unknown, after: unknown) {
  await ctx.store.audit.insertOne({ _id: newId(), actor, action, target, before: before ?? null, after: after ?? null, ts: ctx.now() });
}
