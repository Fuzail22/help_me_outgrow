import type { Ctx } from './context.js';
import type { Entitlement, EntitlementKind, User } from './store/schema.js';
import type { PlatformTopic, Slot } from './platform.js';
import { getSettings } from './settings.js';
import { HttpError } from './http.js';

const DAY_MS = 86400000;

/** Entitlements in force now: started, not expired, not revoked. */
export async function activeEntitlements(ctx: Ctx, userId: string, kind?: EntitlementKind): Promise<Entitlement[]> {
  const now = ctx.now();
  return ctx.store.entitlements.find({ userId, ...(kind ? { kind } : {}), revokedAt: null, startsAt: { $lte: now }, $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] });
}

export function ladderLimit(ladder: { minDays: number; maxSlots: number }[], createdAt: Date, now: Date) {
  const age = (now.getTime() - createdAt.getTime()) / DAY_MS;
  let limit = ladder[0].maxSlots;
  for (const t of ladder) if (age >= t.minDays) limit = t.maxSlots;
  return limit;
}

/** Level picks follow the configured stacking (largest by default); purchases and admin grants add up. */
function bonus(ents: Entitlement[], kind: EntitlementKind, topicId: string, stack: 'max' | 'sum') {
  const mine = ents.filter((e) => e.kind === kind && e.topicId === topicId);
  const level = mine.filter((e) => e.source === 'level').map((e) => e.amount);
  const levelPart = level.length ? (stack === 'max' ? Math.max(...level) : level.reduce((a, b) => a + b, 0)) : 0;
  const rest = mine.filter((e) => e.source !== 'level').reduce((a, e) => a + e.amount, 0);
  return { level: levelPart, paid: mine.filter((e) => e.source === 'purchase').reduce((a, e) => a + e.amount, 0), total: levelPart + rest };
}

export interface TopicLimits { maxSlots: number; maxItems: number; itemsAvailable: number; parts: { base: number; levelSlots: number; paidSlots: number; baseItems: number; levelItems: number; paidItems: number } }

export async function limitsFor(ctx: Ctx, user: User, topics: PlatformTopic[]) {
  const [limits, growth, policy, ents] = await Promise.all([getSettings(ctx, 'limits'), getSettings(ctx, 'growth'), ctx.platform.policy(), activeEntitlements(ctx, user._id)]);
  const base = ladderLimit(limits.baseLadder, user.createdAt, ctx.now());
  const perTopic: Record<string, TopicLimits> = {};
  for (const t of topics) {
    const s = bonus(ents, 'slots', t._id, growth.vavp.vavp1.stack);
    const i = bonus(ents, 'items', t._id, growth.vavp.vavp2.stack);
    perTopic[t._id] = {
      maxSlots: Math.min(base + s.total, policy.policy.maxPerDay), maxItems: limits.baseItems + i.total, itemsAvailable: t.itemCount,
      parts: { base, levelSlots: s.level, paidSlots: s.paid, baseItems: limits.baseItems, levelItems: i.level, paidItems: i.paid },
    };
  }
  return {
    perTopic, maxDurationDays: Math.min(limits.maxDurationDays, policy.policy.maxDurationDays), durations: limits.durations.filter((d) => d.days <= Math.min(limits.maxDurationDays, policy.policy.maxDurationDays)),
    platform: { maxPerDay: policy.policy.maxPerDay, minGapMinutes: policy.policy.minGapMinutes }, endingNotice: limits.endingNotice,
  };
}

/** Topics this person may follow: listed public topics, plus their own (VAVP3). The platform does not check this; we do. */
export async function topicsFor(ctx: Ctx, user: User) {
  const [all, own, ents] = await Promise.all([ctx.platform.topics(), ctx.store.ownTopics.find({ userId: user._id }), activeEntitlements(ctx, user._id, 'own_topic')]);
  // Their own topics while the privilege lasts (a public one is usable by them while it waits for review).
  const live = new Set(ents.map((e) => e._id));
  const mine = new Set(own.filter((o) => o.status !== 'rejected' && live.has(o.entitlementId)).map((o) => o.platformTopicId));
  return all.filter((t) => t.status === 'active' && t.slug !== JOURNAL_TOPIC_SLUG && (mine.has(t._id) || (t.visibility === 'public' && !t.retiredAt)));
}
export const JOURNAL_TOPIC_SLUG = 'journal-prompts';

/** How many notes a schedule asks for: every slot on every date from start to end (inclusive). */
export function notesNeeded(slots: Slot[], startDate: string, endDate: string) {
  const perWeekday = new Map<number, number>();
  for (const s of slots) perWeekday.set(s.day, (perWeekday.get(s.day) ?? 0) + 1);
  let n = 0;
  for (let t = Date.parse(startDate + 'T00:00:00Z'); t <= Date.parse(endDate + 'T00:00:00Z'); t += DAY_MS) {
    const wd = ((new Date(t).getUTCDay() + 6) % 7) + 1; // ISO weekday
    n += perWeekday.get(wd) ?? 0;
  }
  return n;
}

export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY_MS) + 1;
export const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * DAY_MS).toISOString().slice(0, 10);
export const todayIn = (tz: string, now: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

/**
 * The owner's rule: a schedule may not need more notes than the topic can give (unless it loops). When it would,
 * the answer offers three ways out: an earlier end date, fewer times a day, or looping.
 */
export function checkEnough(input: { slots: Slot[]; startDate: string; endDate: string; loop?: boolean | null }, available: number) {
  if (input.loop) return;
  const needed = notesNeeded(input.slots, input.startDate, input.endDate);
  if (needed <= available) return;
  let end = input.endDate;
  while (end > input.startDate && notesNeeded(input.slots, input.startDate, end) > available) end = addDays(end, -1);
  const days = daysBetween(input.startDate, input.endDate);
  const times = new Set(input.slots.map((s) => s.time)).size;
  let fewer = times;
  while (fewer > 1 && Math.ceil((needed / times) * fewer) > available) fewer--;
  throw new HttpError(422, 'not_enough_quotes', `This schedule needs ${needed} notes but the topic has ${available}.`, {
    needed, available, options: { endDate: notesNeeded(input.slots, input.startDate, end) <= available ? end : null, timesPerDay: Math.ceil((needed / times) * fewer) <= available ? fewer : null, loop: true, days },
  });
}
