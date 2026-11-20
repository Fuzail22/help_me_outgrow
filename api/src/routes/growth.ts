import type { Router } from 'express';
import { z } from 'zod';
import type { Ctx } from '../context.js';
import { h, HttpError, parse } from '../http.js';
import { newId } from '../ids.js';
import { COOKIE, readCookie, sessionUser } from '../session.js';
import { growthView, pick, rateLimit, recordVisit } from '../growth.js';
import { audit } from '../admin/auth.js';
import type { AdminRequest } from '../admin/auth.js';
import type { AdminRole } from '../store/schema.js';
import type { RequestHandler } from 'express';

export function growthRoutes(ctx: Ctx, api: Router) {
  api.get('/api/growth', h(async (req, res) => { res.json(await growthView(ctx, await sessionUser(ctx, req))); }));
  api.post('/api/growth/celebrated', h(async (req, res) => {
    const user = await sessionUser(ctx, req);
    const { levels } = parse(z.object({ levels: z.array(z.number().int().min(1)).max(50) }), req.body);
    await ctx.store.levelUnlocks.updateMany({ userId: user._id, level: { $in: levels } }, { $set: { celebrated: true } });
    res.status(204).end();
  }));
  api.post('/api/growth/pick', h(async (req, res) => {
    const user = await sessionUser(ctx, req);
    const b = parse(z.object({ level: z.number().int().min(1), vavp: z.enum(['vavp1', 'vavp2', 'vavp3']), topicId: z.string().max(64).nullish() }), req.body);
    await pick(ctx, user, b);
    res.json(await growthView(ctx, user));
  }));
  /** "I posted about the app and emailed a screenshot to support": support checks the inbox and approves. */
  api.post('/api/growth/proofs', h(async (req, res) => {
    const user = await sessionUser(ctx, req);
    const { note } = parse(z.object({ note: z.string().trim().max(300).default('') }), req.body ?? {});
    if ((await ctx.store.refProofs.count({ userId: user._id, status: 'pending' })) >= 5) throw new HttpError(429, 'too_many_pending', 'Five posts are already waiting for review');
    const p = await ctx.store.refProofs.insertOne({ _id: newId('rp_'), userId: user._id, note, status: 'pending', decidedBy: null, decidedAt: null, createdAt: ctx.now() });
    res.status(201).json({ id: p._id, status: p.status });
  }));

  /** Someone opened a referral link. Public (no sign-in needed); rate-limited per IP. */
  api.post('/api/ref/visit', h(async (req, res) => {
    const b = parse(z.object({ code: z.string().regex(/^[a-z0-9]{4,16}$/), deviceId: z.string().regex(/^[a-zA-Z0-9_-]{8,64}$/) }), req.body);
    const ip = req.ip ?? 'unknown';
    rateLimit(ctx, `ref:${ip}`, 30, ctx.now().getTime());
    let viewerId: string | null = null;
    if (readCookie(req, COOKIE)) viewerId = await sessionUser(ctx, req).then((u) => u._id, () => null);
    const r = await recordVisit(ctx, { code: b.code, deviceId: b.deviceId, ip, viewerId });
    res.json({ ok: true, counted: r.counted });
  }));
}

/** Admin: social-post proofs (support and up). */
export function proofAdminRoutes(ctx: Ctx) {
  return (api: Router, need: (r: AdminRole) => RequestHandler) => {
    const A = '/api/admin';
    api.get(`${A}/proofs`, need('support'), h(async (req, res) => {
      const status = ['pending', 'approved', 'rejected'].includes(String(req.query.status)) ? String(req.query.status) : 'pending';
      const proofs = await ctx.store.refProofs.find({ status }, { sort: { createdAt: status === 'pending' ? 1 : -1 }, limit: 100 });
      const users = new Map((await ctx.store.users.find({ _id: { $in: proofs.map((p) => p.userId) } })).map((u) => [u._id, u]));
      res.json({ proofs: proofs.map((p) => ({ ...p, email: users.get(p.userId)?.email ?? '(deleted)', name: users.get(p.userId)?.name ?? '', referralCode: users.get(p.userId)?.referralCode ?? '' })) });
    }));
    for (const [path, status] of [['approve', 'approved'], ['reject', 'rejected']] as const) {
      api.post(`${A}/proofs/:id/${path}`, need('support'), h(async (req, res) => {
        const a = (req as AdminRequest).admin;
        const p = await ctx.store.refProofs.findOneAndUpdate({ _id: req.params.id, status: 'pending' }, { $set: { status, decidedBy: a.email, decidedAt: ctx.now() } });
        if (!p) throw new HttpError(409, 'not_pending', 'This post was already reviewed');
        await audit(ctx, a.email, `proof.${path}`, p.userId, { status: 'pending' }, { status });
        res.json(p);
      }));
    }
  };
}
