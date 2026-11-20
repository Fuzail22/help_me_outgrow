import type { Router } from 'express';
import { z } from 'zod';
import type { Ctx } from '../context.js';
import { h, HttpError, parse } from '../http.js';
import { sessionUser } from '../session.js';
import { getSettings } from '../settings.js';
import { addDays, checkEnough, daysBetween, limitsFor, todayIn, topicsFor } from '../limits.js';
import type { EnrolmentInput, PlatformAction, PlatformEnrolment } from '../platform.js';
import type { User } from '../store/schema.js';

const slot = z.object({ day: z.number().int().min(1).max(7), time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) });
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const createBody = z.object({ topicId: z.string().min(1).max(64), slots: z.array(slot).min(1).max(7 * 96), timezone: z.string().min(1).max(64), startDate: isoDate.optional(), endDate: isoDate, loop: z.boolean().optional() });
const patchBody = z.object({ action: z.enum(['pause', 'resume', 'cancel']).optional(), slots: z.array(slot).min(1).max(7 * 96).optional(), endDate: isoDate.optional(), reason: z.string().max(40).optional() })
  .refine((b) => b.action || b.slots || b.endDate, 'Send an action, new times or a new end date');
const nextBody = z.object({ choice: z.enum(['loop', 'extend', 'new']), topicId: z.string().max(64).optional(), days: z.number().int().min(1).max(3660).optional() });

export const FEEDBACK_ACTIONS: PlatformAction[] = [{ id: 'up', title: 'Helpful', kind: 'feedback', value: 'up' }, { id: 'down', title: 'Not for me', kind: 'feedback', value: 'down' }];

/** Buttons for a quote enrolment: Helpful / Not for me, or Helpful / Journal on this when the person tied journaling to this topic. */
export async function actionsFor(ctx: Ctx, user: User, topicId: string): Promise<PlatformAction[] | null> {
  const r = await ctx.store.journalReminders.findOne({ _id: user._id });
  if (r?.tiedTopicId !== topicId) return null;
  return [FEEDBACK_ACTIONS[0], { id: 'journal', title: 'Journal on this', kind: 'open', url: `${ctx.config.appOrigin}/journal/new?d={deliveryId}` }];
  // (same button as the journal's own reminders use: routes/journal.ts setTie)
}

export async function endingNoticeFor(ctx: Ctx, enrolmentId: string, notice: { withinDays: number; text: string }) {
  return { ...notice, action: { id: 'next', title: "Choose what's next", kind: 'open' as const, url: `${ctx.config.appOrigin}/next/${enrolmentId}` } };
}

/** Every product rule (allowed topic, times per day, duration, enough quotes) without creating anything. */
export async function prepareCreate(ctx: Ctx, user: User, input: z.infer<typeof createBody>) {
  const topics = await topicsFor(ctx, user);
  const topic = topics.find((t) => t._id === input.topicId);
  if (!topic) throw new HttpError(404, 'not_found', 'Topic not found');
  const lim = await limitsFor(ctx, user, [topic]);
  const tl = lim.perTopic[topic._id];
  const times = new Set(input.slots.map((s) => s.time)).size;
  if (times > tl.maxSlots) throw new HttpError(422, 'too_many_slots', `At most ${tl.maxSlots} times a day for this topic`, { max: tl.maxSlots });
  const startDate = input.startDate ?? todayIn(input.timezone, ctx.now());
  const days = daysBetween(startDate, input.endDate);
  if (days < 1 || days > lim.maxDurationDays) throw new HttpError(422, 'invalid_duration', `Choose between 1 and ${lim.maxDurationDays} days`, { days, max: lim.maxDurationDays });
  const loop = input.loop ?? null;
  checkEnough({ slots: input.slots, startDate, endDate: input.endDate, loop }, Math.min(tl.itemsAvailable, tl.maxItems));
  const body: EnrolmentInput = { topicId: topic._id, slots: input.slots, timezone: input.timezone, startDate, endDate: input.endDate, maxItems: tl.maxItems, loop, actions: await actionsFor(ctx, user, topic._id) };
  return { body, notice: lim.endingNotice };
}

export async function commitCreate(ctx: Ctx, user: User, p: Awaited<ReturnType<typeof prepareCreate>>): Promise<PlatformEnrolment> {
  const e = await ctx.platform.createEnrolment(user._id, p.body);
  // The "choose what's next" button needs the enrolment's id, which exists only now.
  return ctx.platform.patchEnrolment(user._id, e.id, { endingNotice: await endingNoticeFor(ctx, e.id, p.notice) });
}

export const createFor = async (ctx: Ctx, user: User, input: z.infer<typeof createBody>) => commitCreate(ctx, user, await prepareCreate(ctx, user, input));

async function own(ctx: Ctx, user: User, id: string) {
  const e = (await ctx.platform.enrolments(user._id)).find((x) => x.id === id);
  if (!e) throw new HttpError(404, 'not_found', 'Enrolment not found');
  return e;
}

export function enrolmentRoutes(ctx: Ctx, api: Router) {
  /** Before sign-in: the starting allowance, so onboarding can warn early (the server checks again). */
  api.get('/api/public/config', h(async (_req, res) => {
    const lim = await getSettings(ctx, 'limits');
    res.json({ baseItems: lim.baseItems, baseSlots: lim.baseLadder[0].maxSlots, maxDurationDays: lim.maxDurationDays, durations: lim.durations.filter((d) => d.days <= lim.maxDurationDays) });
  }));
  api.get('/api/me/limits', h(async (req, res) => {
    const user = await sessionUser(ctx, req);
    const topics = await topicsFor(ctx, user);
    res.json({ ...(await limitsFor(ctx, user, topics)), topics: topics.map((t) => ({ id: t._id, slug: t.slug, title: t.title, description: t.description, sensitive: t.sensitive, itemCount: t.itemCount, repeat: t.repeat })) });
  }));
  api.get('/api/enrolments', h(async (req, res) => {
    const user = await sessionUser(ctx, req);
    res.json({ enrolments: await ctx.platform.enrolments(user._id) });
  }));
  api.post('/api/enrolments', h(async (req, res) => {
    const user = await sessionUser(ctx, req);
    res.status(201).json(await createFor(ctx, user, parse(createBody, req.body)));
  }));
  api.patch('/api/enrolments/:id', h(async (req, res) => {
    const user = await sessionUser(ctx, req);
    const body = parse(patchBody, req.body);
    const e = await own(ctx, user, req.params.id);
    if (body.slots || body.endDate) {
      const topic = (await ctx.platform.topics()).find((t) => t._id === e.topicId);
      const lim = await limitsFor(ctx, user, topic ? [topic] : []);
      const tl = lim.perTopic[e.topicId];
      const slots = body.slots ?? e.slots; const endDate = body.endDate ?? e.endDate;
      if (tl && new Set(slots.map((s) => s.time)).size > tl.maxSlots) throw new HttpError(422, 'too_many_slots', `At most ${tl.maxSlots} times a day for this topic`, { max: tl.maxSlots });
      const days = daysBetween(e.startDate, endDate);
      if (days > lim.maxDurationDays) throw new HttpError(422, 'invalid_duration', `At most ${lim.maxDurationDays} days`, { days, max: lim.maxDurationDays });
      // Notes still to come must fit what is left of the topic (the cap counts what was already sent).
      if (tl) {
        const from = todayIn(e.timezone, ctx.now());
        const left = Math.min(tl.itemsAvailable - e.position, tl.maxItems - e.sentCount);
        checkEnough({ slots, startDate: from > e.startDate ? from : e.startDate, endDate, loop: e.loop }, Math.max(0, left));
      }
    }
    res.json(await ctx.platform.patchEnrolment(user._id, e.id, body));
  }));

  /** G6: the choice offered in the last days — loop the topic again, extend its quotes, or start a new course. */
  api.post('/api/enrolments/:id/next', h(async (req, res) => {
    const user = await sessionUser(ctx, req);
    const body = parse(nextBody, req.body);
    const e = await own(ctx, user, req.params.id);
    if (e.status === 'cancelled') throw new HttpError(409, 'enrolment_closed', 'This course was stopped');
    const today = todayIn(e.timezone, ctx.now());
    const lim = await limitsFor(ctx, user, await topicsFor(ctx, user));
    const days = Math.min(body.days ?? daysBetween(e.startDate, e.endDate), lim.maxDurationDays);
    const close = async () => { if (e.status === 'active' || e.status === 'paused') await ctx.platform.patchEnrolment(user._id, e.id, { action: 'cancel', reason: `next_${body.choice}` }); };
    if (body.choice === 'extend') {
      // More quotes on the same course: whatever the person's limits now allow (VAVP2 picks, purchases), same times.
      const tl = lim.perTopic[e.topicId];
      if (!tl) throw new HttpError(404, 'not_found', 'Topic not found');
      if (tl.maxItems <= (e.maxItems ?? 0)) throw new HttpError(409, 'nothing_to_extend', 'Unlock or buy more quotes for this topic first', { maxItems: tl.maxItems });
      if (e.status === 'completed') {
        // Finished already: a fresh course that starts where this one stopped is the simplest equivalent.
        return res.status(201).json(await createFor(ctx, user, { topicId: e.topicId, slots: e.slots, timezone: e.timezone, endDate: addDays(today, days - 1), loop: e.loop ?? undefined }));
      }
      const endDate = addDays(e.startDate, Math.min(lim.maxDurationDays, daysBetween(e.startDate, addDays(e.endDate, days))) - 1);
      return res.json(await ctx.platform.patchEnrolment(user._id, e.id, { maxItems: tl.maxItems, endDate }));
    }
    // Loop again (from the first line) or a new course: this one ends now; a new one starts with the same times.
    const topicId = body.choice === 'loop' ? e.topicId : body.topicId;
    if (!topicId) throw new HttpError(422, 'validation_failed', 'Choose a topic for the new course');
    // Check every rule first, so a refusal never leaves the person with the old course stopped and no new one.
    const ready = await prepareCreate(ctx, user, { topicId, slots: e.slots, timezone: e.timezone, endDate: addDays(today, days - 1), loop: body.choice === 'loop' ? true : undefined });
    await close();
    res.status(201).json(await commitCreate(ctx, user, ready));
  }));
}
