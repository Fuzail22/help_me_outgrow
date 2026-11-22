import type { RequestHandler, Router } from 'express';
import { z } from 'zod';
import type { Ctx } from '../context.js';
import { h, HttpError, parse } from '../http.js';
import { newId } from '../ids.js';
import { sessionUser } from '../session.js';
import { activeEntitlements, JOURNAL_TOPIC_SLUG } from '../limits.js';
import { getSettings } from '../settings.js';
import { checkText } from '../content.js';
import { audit, type AdminRequest } from '../admin/auth.js';
import express from 'express';
import { apply, plan, readZip } from '../importer.js';
import type { AdminRole, OwnTopic, User } from '../store/schema.js';

const lineBody = z.object({ body: z.string().trim().min(1).max(300), attribution: z.string().trim().max(120).nullish() });
const withWarnings = <T extends { body: string }>(l: T) => ({ ...l, warnings: checkText(l.body) });

/** An own topic whose privilege (purchase or level pick) is still in force. */
async function ownTopic(ctx: Ctx, user: User, id: string): Promise<OwnTopic> {
  const t = await ctx.store.ownTopics.findOne({ _id: id, userId: user._id });
  if (!t) throw new HttpError(404, 'not_found', 'Topic not found');
  if (!(await activeEntitlements(ctx, user._id, 'own_topic')).some((e) => e._id === t.entitlementId)) throw new HttpError(403, 'expired', 'This topic’s privilege has ended; renew it on the upgrade page');
  return t;
}

/** VAVP3: a topic of one's own, up to the configured number of lines (150). Private, or public after review. */
export function ownTopicRoutes(ctx: Ctx, api: Router) {
  api.get('/api/own-topics', h(async (req, res) => {
    const user = await sessionUser(ctx, req);
    const [topics, ents, lim] = await Promise.all([ctx.store.ownTopics.find({ userId: user._id }, { sort: { createdAt: 1 } }), activeEntitlements(ctx, user._id, 'own_topic'), getSettings(ctx, 'limits')]);
    const used = new Set(topics.map((t) => t.entitlementId));
    const platform = new Map((await ctx.platform.topics()).map((t) => [t._id, t]));
    res.json({
      lineCap: lim.ownTopicLineCap, supportEmail: ctx.config.supportEmail,
      available: ents.filter((e) => !used.has(e._id)).map((e) => ({ entitlementId: e._id, visibility: (e.meta?.visibility as string) ?? 'any', expiresAt: e.expiresAt })),
      topics: topics.map((t) => ({ ...t, active: ents.some((e) => e._id === t.entitlementId), lines: platform.get(t.platformTopicId)?.itemCount ?? 0 })),
    });
  }));
  api.post('/api/own-topics', h(async (req, res) => {
    const user = await sessionUser(ctx, req);
    const b = parse(z.object({ title: z.string().trim().min(2).max(60), description: z.string().trim().max(300).default(''), visibility: z.enum(['private', 'public']) }), req.body);
    const used = new Set((await ctx.store.ownTopics.find({ userId: user._id })).map((t) => t.entitlementId));
    const ent = (await activeEntitlements(ctx, user._id, 'own_topic')).find((e) => !used.has(e._id) && [b.visibility, 'any'].includes((e.meta?.visibility as string) ?? 'any'));
    if (!ent) throw new HttpError(402, 'no_privilege', `Unlock or buy a ${b.visibility} topic first`);
    const n = (await ctx.store.ownTopics.count({ userId: user._id })) + 1;
    const slug = `u-${user._id.slice(-8).toLowerCase()}-${n}`;
    // Always created private on the platform; a public one is published only after an editor's review.
    const pt = await ctx.platform.createTopic({ slug, title: b.title, description: b.description, visibility: 'private', repeat: false, sensitive: false });
    const t = await ctx.store.ownTopics.insertOne({ _id: newId('ot_'), userId: user._id, platformTopicId: pt._id, title: b.title, visibility: b.visibility, status: b.visibility === 'public' ? 'review' : 'live', lineCap: (await getSettings(ctx, 'limits')).ownTopicLineCap, entitlementId: ent._id, createdAt: ctx.now() });
    res.status(201).json(t);
  }));
  api.get('/api/own-topics/:id/lines', h(async (req, res) => {
    const t = await ownTopic(ctx, await sessionUser(ctx, req), req.params.id);
    res.json({ topic: t, lines: (await ctx.platform.lines(t.platformTopicId)).map(withWarnings) });
  }));
  api.post('/api/own-topics/:id/lines', h(async (req, res) => {
    const t = await ownTopic(ctx, await sessionUser(ctx, req), req.params.id);
    const { lines } = parse(z.object({ lines: z.array(lineBody).min(1).max(150) }), req.body);
    const have = (await ctx.platform.lines(t.platformTopicId)).length;
    if (have + lines.length > t.lineCap) throw new HttpError(422, 'line_cap', `Your topic can hold ${t.lineCap} lines (${have} so far). For more, write to ${ctx.config.supportEmail}.`, { cap: t.lineCap, have });
    const r = await ctx.platform.appendLines(t.platformTopicId, lines);
    res.status(201).json({ created: r.created.map(withWarnings), skip: r.skip });
  }));
  api.patch('/api/own-topics/:id/lines/:lineId', h(async (req, res) => {
    const t = await ownTopic(ctx, await sessionUser(ctx, req), req.params.id);
    res.json(withWarnings(await ctx.platform.editLine(t.platformTopicId, req.params.lineId, parse(lineBody, req.body))));
  }));
}

/** Admin: topics and lines through the platform's content API (moved here from the platform console), and VAVP3 review. */
export function topicAdminRoutes(ctx: Ctx) {
  return (api: Router, need: (r: AdminRole) => RequestHandler) => {
    const A = '/api/admin';
    const who = (req: unknown) => (req as AdminRequest).admin.email;
    api.post(`${A}/content-check`, need('viewer'), h(async (req, res) => { res.json({ warnings: checkText(parse(z.object({ text: z.string().max(2000) }), req.body).text) }); }));
    api.get(`${A}/topics`, need('editor'), h(async (_req, res) => {
      const [topics, own] = await Promise.all([ctx.platform.topics(), ctx.store.ownTopics.find({})]);
      const owned = new Map(own.map((o) => [o.platformTopicId, o]));
      res.json({ topics: topics.map((t) => ({ ...t, own: owned.get(t._id) ? { userId: owned.get(t._id)!.userId, status: owned.get(t._id)!.status, visibility: owned.get(t._id)!.visibility } : null, system: t.slug === JOURNAL_TOPIC_SLUG })) });
    }));
    api.post(`${A}/topics`, need('editor'), h(async (req, res) => {
      const b = parse(z.object({ slug: z.string().regex(/^[a-z0-9-]{2,40}$/), title: z.string().trim().min(1).max(60), description: z.string().trim().max(300).default(''), sensitive: z.boolean().default(false), repeat: z.boolean().default(false), visibility: z.enum(['public', 'private']).default('private') }), req.body);
      const t = await ctx.platform.createTopic(b);
      await audit(ctx, who(req), 'topic.create', b.slug, null, b);
      res.status(201).json(t);
    }));
    api.patch(`${A}/topics/:id`, need('editor'), h(async (req, res) => {
      const b = parse(z.object({ title: z.string().trim().min(1).max(60).optional(), description: z.string().trim().max(300).optional(), sensitive: z.boolean().optional(), repeat: z.boolean().optional(), visibility: z.enum(['public', 'private']).optional(), retired: z.boolean().optional() }), req.body);
      const before = (await ctx.platform.topics()).find((t) => t._id === req.params.id);
      const t = await ctx.platform.patchTopic(req.params.id, b);
      await audit(ctx, who(req), 'topic.update', t.slug, before ? Object.fromEntries(Object.keys(b).map((k) => [k, k === 'retired' ? !!before.retiredAt : (before as any)[k]])) : null, b);
      res.json(t);
    }));
    api.get(`${A}/topics/:id/lines`, need('editor'), h(async (req, res) => { res.json({ lines: (await ctx.platform.lines(req.params.id)).map(withWarnings) }); }));
    api.post(`${A}/topics/:id/lines`, need('editor'), h(async (req, res) => {
      const { lines } = parse(z.object({ lines: z.array(lineBody).min(1).max(1000) }), req.body);
      const r = await ctx.platform.appendLines(req.params.id, lines);
      if (r.created.length) await audit(ctx, who(req), 'line.add', req.params.id, null, { lines: r.created.map((l) => ({ number: l.number, body: l.body })) });
      res.status(201).json({ created: r.created.map(withWarnings), skip: r.skip });
    }));
    api.patch(`${A}/topics/:id/lines/:lineId`, need('editor'), h(async (req, res) => {
      const before = (await ctx.platform.lines(req.params.id)).find((l) => l.id === req.params.lineId);
      const l = await ctx.platform.editLine(req.params.id, req.params.lineId, parse(lineBody, req.body));
      await audit(ctx, who(req), 'line.edit', `${req.params.id} #${l.number}`, before ? { body: before.body } : null, { body: l.body });
      res.json(withWarnings(l));
    }));
    /** G10: bulk import from a zip of CSVs. `?dryRun=1` previews and saves nothing. Body: the zip (application/zip). */
    api.post(`${A}/topics/import`, express.raw({ type: ['application/zip', 'application/x-zip-compressed', 'application/octet-stream'], limit: '5mb' }), need('editor'), h(async (req, res) => {
      if (!Buffer.isBuffer(req.body) || !req.body.length) throw new HttpError(422, 'invalid_zip', 'Send the zip file as the request body');
      const items = await plan(ctx, readZip(req.body));
      const view = (it: Awaited<ReturnType<typeof plan>>[number]) => ({
        file: it.file, slug: it.slug, action: it.action, title: it.meta.title, visibility: it.meta.visibility ?? (it.action === 'create' ? 'private' : null),
        existingNotes: it.existingNotes, adding: it.add.length, duplicates: it.duplicates, warnings: it.warnings, changes: it.changes, errors: it.errors,
        sample: it.add.slice(0, 3).map((n) => ({ body: n.body, link: n.clickUrl, media: n.imageUrl, warnings: n.warnings.map((w) => w.match) })),
      });
      if (req.query.dryRun) return res.json({ dryRun: true, topics: items.map(view) });
      const results = await apply(ctx, items, (action, target, after) => audit(ctx, who(req), action, target, null, after));
      res.json({ dryRun: false, topics: items.map(view), results });
    }));
    api.get(`${A}/own-topics`, need('editor'), h(async (req, res) => {
      const status = ['review', 'live', 'rejected'].includes(String(req.query.status)) ? String(req.query.status) : 'review';
      const list = await ctx.store.ownTopics.find({ status }, { sort: { createdAt: 1 } });
      const users = new Map((await ctx.store.users.find({ _id: { $in: list.map((t) => t.userId) } })).map((u) => [u._id, u.email]));
      res.json({ topics: list.map((t) => ({ ...t, email: users.get(t.userId) ?? '(deleted)' })) });
    }));
    for (const [path, status] of [['approve', 'live'], ['reject', 'rejected']] as const) {
      api.post(`${A}/own-topics/:id/${path}`, need('editor'), h(async (req, res) => {
        const t = await ctx.store.ownTopics.findOneAndUpdate({ _id: req.params.id, status: 'review' }, { $set: { status } });
        if (!t) throw new HttpError(409, 'not_in_review', 'This topic is not waiting for review');
        if (status === 'live') await ctx.platform.patchTopic(t.platformTopicId, { visibility: 'public' });
        await audit(ctx, who(req), `own_topic.${path}`, t.platformTopicId, { status: 'review' }, { status });
        res.json(t);
      }));
    }
  };
}
