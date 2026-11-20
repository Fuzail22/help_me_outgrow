import type { RequestHandler, Router } from 'express';
import { z } from 'zod';
import type { Ctx } from '../context.js';
import { h, HttpError, parse } from '../http.js';
import { sessionUser } from '../session.js';
import { addEntry, journalTopic, open, reminderWindow, seal, toMarkdown, view } from '../journal.js';
import { FEEDBACK_ACTIONS } from './enrolments.js';
import { writeAction } from '../journal.js';
import type { AdminRole, User } from '../store/schema.js';
import type { Slot } from '../platform.js';

const slot = z.object({ day: z.number().int().min(1).max(7), time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) });
const entryBody = z.object({ text: z.string().trim().min(1).max(10000), mood: z.number().int().min(1).max(5).nullish(), deliveryId: z.string().max(64).nullish(), prompt: z.string().max(200).nullish() });

async function own(ctx: Ctx, user: User, id: string) {
  const e = await ctx.store.journal.findOne({ _id: id, userId: user._id });
  if (!e) throw new HttpError(404, 'not_found', 'Entry not found');
  return e;
}

/** Quote buttons: Helpful + Journal on this, for the tied topic's running courses (and new ones, via actionsFor). */
async function setTie(ctx: Ctx, user: User, topicId: string | null, previous: string | null) {
  for (const e of await ctx.platform.enrolments(user._id)) {
    if (e.status !== 'active' && e.status !== 'paused') continue;
    if (topicId && e.topicId === topicId) await ctx.platform.patchEnrolment(user._id, e.id, { actions: [FEEDBACK_ACTIONS[0], { ...writeAction(ctx), id: 'journal', title: 'Journal on this' }] });
    else if (previous && e.topicId === previous) await ctx.platform.patchEnrolment(user._id, e.id, { actions: null });
  }
}

export function journalRoutes(ctx: Ctx, api: Router) {
  api.get('/api/journal', h(async (req, res) => {
    const user = await sessionUser(ctx, req);
    const before = typeof req.query.before === 'string' && !Number.isNaN(Date.parse(req.query.before)) ? new Date(req.query.before) : null;
    const list = await ctx.store.journal.find({ userId: user._id, ...(before ? { ts: { $lt: before } } : {}) }, { sort: { ts: -1 }, limit: 30 });
    res.json({ entries: list.map((e) => view(ctx, e)), more: list.length === 30 });
  }));
  api.post('/api/journal', h(async (req, res) => { res.status(201).json(await addEntry(ctx, await sessionUser(ctx, req), parse(entryBody, req.body))); }));
  api.patch('/api/journal/:id', h(async (req, res) => {
    const user = await sessionUser(ctx, req);
    const e = await own(ctx, user, req.params.id);
    const b = parse(z.object({ text: z.string().trim().min(1).max(10000).optional(), mood: z.number().int().min(1).max(5).nullish() }), req.body);
    const c = open(ctx, e);
    const next = { ...c, ...(b.text !== undefined ? { text: b.text } : {}), ...(b.mood !== undefined ? { mood: b.mood ?? null } : {}) };
    const u = await ctx.store.journal.findOneAndUpdate({ _id: e._id }, { $set: { ...seal(ctx, user._id, next), updatedAt: ctx.now(), hasMood: next.mood !== null } });
    res.json(view(ctx, u!));
  }));
  api.delete('/api/journal/:id', h(async (req, res) => { const user = await sessionUser(ctx, req); await own(ctx, user, req.params.id); await ctx.store.journal.deleteMany({ _id: req.params.id, userId: user._id }); res.status(204).end(); }));
  /** Everything, for the person only: JSON or Markdown. */
  api.get('/api/journal/export', h(async (req, res) => {
    const user = await sessionUser(ctx, req);
    const entries = (await ctx.store.journal.find({ userId: user._id }, { sort: { ts: 1 } })).map((e) => view(ctx, e));
    const md = req.query.format === 'md';
    res.setHeader('content-disposition', `attachment; filename="journal-${ctx.now().toISOString().slice(0, 10)}.${md ? 'md' : 'json'}"`);
    res.setHeader('cache-control', 'no-store');
    if (md) { res.setHeader('content-type', 'text/markdown; charset=utf-8'); return res.send(toMarkdown(entries)); }
    res.json({ exportedAt: ctx.now(), entries });
  }));
  api.delete('/api/journal', h(async (req, res) => {
    const user = await sessionUser(ctx, req);
    parse(z.object({ confirm: z.literal('delete everything') }), req.body);
    res.json({ deleted: await ctx.store.journal.deleteMany({ userId: user._id }) });
  }));

  // ---- reminders: their own times (a private "Journal" topic on the platform), or on the notes of one quote topic
  api.get('/api/journal/reminder', h(async (req, res) => {
    const user = await sessionUser(ctx, req);
    const r = await ctx.store.journalReminders.findOne({ _id: user._id });
    const e = r?.enrolmentId ? (await ctx.platform.enrolments(user._id)).find((x) => x.id === r.enrolmentId && (x.status === 'active' || x.status === 'paused')) : null;
    res.json({ mode: e ? 'own' : r?.tiedTopicId ? 'tie' : 'off', slots: e?.slots ?? r?.slots ?? [], timezone: e?.timezone ?? r?.timezone ?? null, tiedTopicId: r?.tiedTopicId ?? null, nextSendAt: e?.nextSendAt ?? null, endDate: e?.endDate ?? null });
  }));
  api.put('/api/journal/reminder', h(async (req, res) => {
    const user = await sessionUser(ctx, req);
    const b = parse(z.discriminatedUnion('mode', [
      z.object({ mode: z.literal('off') }),
      z.object({ mode: z.literal('own'), slots: z.array(slot).min(1).max(7 * 3), timezone: z.string().min(1).max(64) }),
      z.object({ mode: z.literal('tie'), topicId: z.string().min(1).max(64) }),
    ]), req.body);
    const prev = await ctx.store.journalReminders.findOne({ _id: user._id });
    // Stop the previous reminder course, if any.
    if (prev?.enrolmentId) {
      const e = (await ctx.platform.enrolments(user._id)).find((x) => x.id === prev.enrolmentId);
      if (e && (e.status === 'active' || e.status === 'paused')) await ctx.platform.patchEnrolment(user._id, e.id, { action: 'cancel', reason: 'journal_reminder_changed' });
    }
    let enrolmentId: string | null = null; let slots: Slot[] = []; let timezone = 'UTC'; let tied: string | null = null;
    if (b.mode === 'own') {
      if (new Set(b.slots.map((s) => s.time)).size > 3) throw new HttpError(422, 'too_many_slots', 'At most 3 reminder times a day');
      const topic = await journalTopic(ctx);
      const e = await ctx.platform.createEnrolment(user._id, { topicId: topic._id, slots: b.slots, timezone: b.timezone, ...reminderWindow(b.timezone, ctx.now()), loop: true, maxItems: null,
        endingNotice: { withinDays: 3, text: 'Journal reminders end in {daysLeft} days; renew them in the app.', action: { id: 'renew', title: 'Renew', kind: 'open', url: `${ctx.config.appOrigin}/journal?renew=1` } } });
      enrolmentId = e.id; slots = b.slots; timezone = b.timezone;
    }
    if (b.mode === 'tie') {
      if (!(await ctx.platform.enrolments(user._id)).some((e) => e.topicId === b.topicId && (e.status === 'active' || e.status === 'paused'))) throw new HttpError(422, 'validation_failed', 'Choose a topic you are following now');
      tied = b.topicId;
    }
    if ((prev?.tiedTopicId ?? null) !== tied) await setTie(ctx, user, tied, prev?.tiedTopicId ?? null);
    const fields = { enrolmentId, tiedTopicId: tied, slots, timezone, updatedAt: ctx.now() };
    if (prev) await ctx.store.journalReminders.updateOne({ _id: user._id }, { $set: fields }); else await ctx.store.journalReminders.insertOne({ _id: user._id, ...fields });
    res.json({ mode: b.mode, enrolmentId, tiedTopicId: tied });
  }));
}

/** Admin: counts and timestamps only. Entry content cannot be read here (or anywhere but the person's own session). */
export function journalAdminRoutes(ctx: Ctx) {
  return (api: Router, need: (r: AdminRole) => RequestHandler) => {
    api.get('/api/admin/journal-stats', need('viewer'), h(async (_req, res) => {
      const since = new Date(ctx.now().getTime() - 30 * 86400000);
      const recent = await ctx.store.journal.find({ ts: { $gte: since } });
      const perDay: Record<string, number> = {};
      for (const e of recent) { const d = e.ts.toISOString().slice(0, 10); perDay[d] = (perDay[d] ?? 0) + 1; }
      const reminders = await ctx.store.journalReminders.find({});
      res.json({
        total: await ctx.store.journal.count({}), last30Days: recent.length, writers30d: new Set(recent.map((e) => e.userId)).size,
        withQuote30d: recent.filter((e) => e.hasQuote).length, withMood30d: recent.filter((e) => e.hasMood).length, perDay,
        reminders: { own: reminders.filter((r) => r.enrolmentId).length, tiedToQuotes: reminders.filter((r) => r.tiedTopicId).length },
      });
    }));
  };
}
