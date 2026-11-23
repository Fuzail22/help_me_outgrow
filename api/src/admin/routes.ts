import type { Router } from 'express';
import { z } from 'zod';
import type { Ctx } from '../context.js';
import { h, HttpError, parse } from '../http.js';
import { newId } from '../ids.js';
import { getSettings, putSettings, type SettingsId } from '../settings.js';
import { activeEntitlements } from '../limits.js';
import { audit, requireAdmin, ROLES, type AdminRequest } from './auth.js';
import type { AdminRole } from '../store/schema.js';

const role = z.enum(ROLES as [AdminRole, ...AdminRole[]]);
const ar = (req: unknown) => (req as AdminRequest).admin;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The admin API (`/api/admin/*`). Each route states its minimum role; every change is audited. */
export function adminRoutes(ctx: Ctx, api: Router, extend: ((admin: Router, need: (r: AdminRole) => ReturnType<typeof requireAdmin>) => void)[] = []) {
  const need = (r: AdminRole) => requireAdmin(ctx, r);
  const A = '/api/admin';

  api.get(`${A}/me`, need('viewer'), h(async (req, res) => { res.json(ar(req)); }));

  // ---- admins (owners only)
  api.get(`${A}/admins`, need('owner'), h(async (_req, res) => { res.json({ admins: await ctx.store.admins.find({}, { sort: { createdAt: 1 } }) }); }));
  api.post(`${A}/admins`, need('owner'), h(async (req, res) => {
    const b = parse(z.object({ email: z.string().trim().toLowerCase().email().max(254), role }), req.body);
    if (await ctx.store.admins.findOne({ email: b.email })) throw new HttpError(409, 'already_admin', 'This address is already an admin');
    const a = await ctx.store.admins.insertOne({ _id: newId('a_'), email: b.email, role: b.role, invitedBy: ar(req).email, createdAt: ctx.now(), lastSignInAt: null });
    await audit(ctx, ar(req).email, 'admin.invite', b.email, null, { role: b.role });
    res.status(201).json(a);
  }));
  api.patch(`${A}/admins/:id`, need('owner'), h(async (req, res) => {
    const b = parse(z.object({ role }), req.body);
    const a = await ctx.store.admins.findOne({ _id: req.params.id });
    if (!a) throw new HttpError(404, 'not_found', 'No such admin');
    if (a.role === 'owner' && b.role !== 'owner' && (await ctx.store.admins.count({ role: 'owner' })) === 1) throw new HttpError(409, 'last_owner', 'There must always be one owner');
    await ctx.store.admins.updateOne({ _id: a._id }, { $set: { role: b.role } });
    await audit(ctx, ar(req).email, 'admin.role', a.email, { role: a.role }, { role: b.role });
    res.json({ ...a, role: b.role });
  }));
  api.delete(`${A}/admins/:id`, need('owner'), h(async (req, res) => {
    const a = await ctx.store.admins.findOne({ _id: req.params.id });
    if (!a) throw new HttpError(404, 'not_found', 'No such admin');
    if (a.role === 'owner' && (await ctx.store.admins.count({ role: 'owner' })) === 1) throw new HttpError(409, 'last_owner', 'There must always be one owner');
    await ctx.store.admins.deleteMany({ _id: a._id });
    await audit(ctx, ar(req).email, 'admin.remove', a.email, { role: a.role }, null);
    res.status(204).end();
  }));
  api.get(`${A}/audit`, need('owner'), h(async (req, res) => {
    const before = typeof req.query.before === 'string' ? req.query.before : null;
    res.json({ entries: await ctx.store.audit.find(before ? { _id: { $lt: before } } : {}, { sort: { _id: -1 }, limit: 50 }) });
  }));

  // ---- settings: limits and growth by editors, pricing by owners
  const settingsRole = (id: string): AdminRole => (id === 'pricing' ? 'owner' : 'editor');
  const settingsId = (id: string): SettingsId => { if (!['limits', 'growth', 'pricing'].includes(id)) throw new HttpError(404, 'not_found', 'No such settings'); return id as SettingsId; };
  api.get(`${A}/settings/:id`, need('viewer'), h(async (req, res) => {
    const id = settingsId(req.params.id);
    const [data, doc, policy] = await Promise.all([getSettings(ctx, id), ctx.store.settings.findOne({ _id: id }), ctx.platform.policy()]);
    res.json({ id, data, updatedAt: doc?.updatedAt ?? null, updatedBy: doc?.updatedBy ?? null, isDefault: !doc, platform: policy.policy });
  }));
  api.put(`${A}/settings/:id`, need('editor'), h(async (req, res) => {
    const id = settingsId(req.params.id);
    if (settingsRole(id) === 'owner' && ar(req).role !== 'owner') throw new HttpError(403, 'forbidden', 'Prices are changed by an owner');
    if (id === 'limits') {
      const p = (await ctx.platform.policy()).policy; const d = (req.body ?? {}) as any;
      if (d.maxDurationDays > p.maxDurationDays) throw new HttpError(422, 'invalid_settings', `The platform allows at most ${p.maxDurationDays} days`, [{ path: 'maxDurationDays', message: `At most ${p.maxDurationDays}` }]);
    }
    const r = await putSettings(ctx, id, req.body, ar(req).email);
    await audit(ctx, ar(req).email, `settings.${id}`, null, r.before, r.after);
    res.json({ id, data: r.after });
  }));

  // ---- people (support and up): search by email or id; what they have and why
  api.get(`${A}/users`, need('support'), h(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase().slice(0, 100) : '';
    const filter = q ? { $or: [{ email: { $regex: escapeRe(q) } }, { _id: q }, { referralCode: q }] } : {};
    const users = await ctx.store.users.find(filter, { sort: { createdAt: -1 }, limit: 50 });
    res.json({ users: users.map((u) => ({ id: u._id, email: u.email, name: u.name, createdAt: u.createdAt, referralCode: u.referralCode, providers: Object.keys(u.providers ?? {}) })) });
  }));
  api.get(`${A}/users/:id`, need('support'), h(async (req, res) => {
    const u = await ctx.store.users.findOne({ _id: req.params.id });
    if (!u) throw new HttpError(404, 'not_found', 'No such person');
    const [ents, unlocks, orders, proofs, visits, signups] = await Promise.all([
      ctx.store.entitlements.find({ userId: u._id }, { sort: { startsAt: -1 } }), ctx.store.levelUnlocks.find({ userId: u._id }, { sort: { level: 1 } }),
      ctx.store.orders.find({ userId: u._id }, { sort: { createdAt: -1 } }), ctx.store.refProofs.find({ userId: u._id }, { sort: { createdAt: -1 } }),
      ctx.store.refVisits.count({ ownerId: u._id }), ctx.store.users.count({ 'referredBy.userId': u._id }),
    ]);
    const active = new Set((await activeEntitlements(ctx, u._id)).map((e) => e._id));
    // Journal content is never shown here, only how many entries exist.
    res.json({
      user: { id: u._id, email: u.email, name: u.name, createdAt: u.createdAt, referralCode: u.referralCode, referredBy: u.referredBy ?? null, providers: Object.keys(u.providers ?? {}) },
      entitlements: ents.map((e) => ({ ...e, active: active.has(e._id) })), unlocks, orders, proofs, referrals: { visits, signups },
      journalEntries: await ctx.store.journal.count({ userId: u._id }),
      groups: (await ctx.store.groups.find({ _id: { $in: (await ctx.store.groupMembers.find({ userId: u._id })).map((m) => m.groupId) } }, { sort: { nameKey: 1 } })).map((g) => ({ id: g._id, name: g.name })),
    });
  }));
  api.post(`${A}/users/:id/entitlements`, need('owner'), h(async (req, res) => {
    const b = parse(z.object({ kind: z.enum(['slots', 'items', 'own_topic']), topicId: z.string().max(64).nullable(), amount: z.number().int().min(1).max(1000), months: z.number().int().min(1).max(120).nullable(), note: z.string().trim().min(1).max(200) }), req.body);
    if (!(await ctx.store.users.count({ _id: req.params.id }))) throw new HttpError(404, 'not_found', 'No such person');
    const now = ctx.now(); const expiresAt = b.months ? new Date(new Date(now).setUTCMonth(now.getUTCMonth() + b.months)) : null;
    const e = await ctx.store.entitlements.insertOne({ _id: newId('ent_'), userId: req.params.id, kind: b.kind, topicId: b.topicId, amount: b.amount, source: 'admin', sourceRef: ar(req).email, startsAt: now, expiresAt, revokedAt: null, meta: { note: b.note } });
    await audit(ctx, ar(req).email, 'entitlement.grant', req.params.id, null, { kind: b.kind, topicId: b.topicId, amount: b.amount, expiresAt, note: b.note });
    res.status(201).json(e);
  }));
  api.delete(`${A}/users/:id/entitlements/:entId`, need('owner'), h(async (req, res) => {
    const e = await ctx.store.entitlements.findOneAndUpdate({ _id: req.params.entId, userId: req.params.id, revokedAt: null }, { $set: { revokedAt: ctx.now() } });
    if (!e) throw new HttpError(404, 'not_found', 'No such active entitlement');
    await audit(ctx, ar(req).email, 'entitlement.revoke', req.params.id, { kind: e.kind, topicId: e.topicId, amount: e.amount, source: e.source }, null);
    res.status(204).end();
  }));

  // ---- overview for everyone in the admin
  api.get(`${A}/overview`, need('viewer'), h(async (_req, res) => {
    const s = ctx.store; const since = new Date(ctx.now().getTime() - 30 * 86400000);
    const [users, newUsers, unlocks, visits, proofsPending, paid, journal] = await Promise.all([
      s.users.count({}), s.users.count({ createdAt: { $gte: since } }), s.levelUnlocks.find({}), s.refVisits.count({}), s.refProofs.count({ status: 'pending' }),
      s.orders.find({ status: 'paid' }), s.journal.count({}),
    ]);
    const levels: Record<string, number> = {}; for (const u of unlocks) levels[u.level] = (levels[u.level] ?? 0) + 1;
    const revenue: Record<string, number> = {}; for (const o of paid) revenue[o.currency] = (revenue[o.currency] ?? 0) + o.amountMinor;
    res.json({ users, newUsers30d: newUsers, levels, referralVisits: visits, signupsReferred: await s.users.count({ 'referredBy.userId': { $exists: true, $ne: null } }), proofsPending, orders: paid.length, revenueMinor: revenue, journalEntries: journal });
  }));

  for (const x of extend) x(api, need);
}
