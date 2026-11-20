import { createHash } from 'node:crypto';
import type { Ctx } from './context.js';
import { HttpError } from './http.js';
import { newId } from './ids.js';
import { getSettings, type GrowthSettings } from './settings.js';
import { limitsFor, topicsFor } from './limits.js';
import type { LevelUnlock, User, VavpId } from './store/schema.js';
import { DuplicateKeyError } from './store/types.js';

/**
 * Levels (VAVP: value added, value provided). Everything is checked from numbers this app can see: ratings come from
 * the platform's per-person summary, referral visits and sign-ups from this app's own records, social posts from the
 * support team's approvals (one approved post counts as one referral visit too). A level, once reached, stays.
 */
export type TaskType = GrowthSettings['levels'][number]['tasks'][number]['type'];
export type Counts = Record<TaskType, number>;

const ratingsCache = new Map<string, { n: number; at: number }>();
const RATINGS_TTL_MS = 60_000;
export const forgetRatings = (userId: string) => ratingsCache.delete(userId);

export async function countsFor(ctx: Ctx, user: User): Promise<Counts> {
  const cached = ratingsCache.get(user._id);
  let ratings: number;
  if (cached && ctx.now().getTime() - cached.at < RATINGS_TTL_MS) ratings = cached.n;
  else {
    ratings = await ctx.platform.summary(user._id).then((s) => s.rated, () => cached?.n ?? 0);
    ratingsCache.set(user._id, { n: ratings, at: ctx.now().getTime() });
  }
  const [visits, signups, posts] = await Promise.all([
    ctx.store.refVisits.count({ ownerId: user._id }), ctx.store.users.count({ 'referredBy.userId': user._id }),
    ctx.store.refProofs.count({ userId: user._id, status: 'approved' }),
  ]);
  return { ratings, referral_visits: visits + posts, referral_signups: signups, approved_posts: posts };
}

export function levelReached(level: GrowthSettings['levels'][number], c: Counts) {
  const done = level.tasks.map((t) => c[t.type] >= t.count);
  return level.mode === 'all' ? done.every(Boolean) : done.some(Boolean);
}

/** What each VAVP gives at a level (0 = not offered there). */
export function optionsAt(g: GrowthSettings, level: number): { vavp: VavpId; amount: number }[] {
  return (['vavp1', 'vavp2', 'vavp3'] as const).map((v) => ({ vavp: v, amount: Number(g.vavp[v].levels[String(level)] ?? 0) })).filter((o) => o.amount > 0);
}

/** Records every level now reached (in order: level 2 needs level 1). Returns all unlocks. */
export async function evaluate(ctx: Ctx, user: User): Promise<{ unlocks: LevelUnlock[]; counts: Counts; growth: GrowthSettings }> {
  const [growth, counts] = await Promise.all([getSettings(ctx, 'growth'), countsFor(ctx, user)]);
  const have = new Map((await ctx.store.levelUnlocks.find({ userId: user._id })).map((u) => [u.level, u]));
  for (const l of growth.levels) {
    if (have.has(l.level)) continue;
    if (!levelReached(l, counts)) break;
    const u: LevelUnlock = { _id: newId('lv_'), userId: user._id, level: l.level, at: ctx.now(), celebrated: false, pick: null };
    try { await ctx.store.levelUnlocks.insertOne(u); have.set(l.level, u); } catch (e) {
      if (!(e instanceof DuplicateKeyError)) throw e;
      have.set(l.level, (await ctx.store.levelUnlocks.findOne({ userId: user._id, level: l.level }))!);
    }
    ctx.log({ msg: 'level_reached', userId: user._id, level: l.level });
  }
  return { unlocks: [...have.values()].sort((a, b) => a.level - b.level), counts, growth };
}

export async function growthView(ctx: Ctx, user: User) {
  const { unlocks, counts, growth } = await evaluate(ctx, user);
  const byLevel = new Map(unlocks.map((u) => [u.level, u]));
  const reached = unlocks.length ? Math.max(...unlocks.map((u) => u.level)) : 0;
  const pending = await ctx.store.refProofs.find({ userId: user._id }, { sort: { createdAt: -1 }, limit: 10 });
  return {
    level: reached,
    levels: growth.levels.map((l) => {
      const u = byLevel.get(l.level);
      return { level: l.level, mode: l.mode, tasks: l.tasks.map((t) => ({ ...t, have: Math.min(counts[t.type], t.count) })), reached: !!u, at: u?.at ?? null, pick: u?.pick ?? null, options: optionsAt(growth, l.level) };
    }),
    celebrate: unlocks.filter((u) => !u.celebrated).map((u) => u.level),
    counts,
    referral: { code: user.referralCode, url: `${ctx.config.appOrigin}/r/${user.referralCode}` },
    proofs: pending.map((p) => ({ id: p._id, status: p.status, createdAt: p.createdAt })),
    supportEmail: ctx.config.supportEmail,
  };
}

/** One pick per reached level, among the VAVPs open at that level. VAVP1/VAVP2 need a topic the person may follow. */
export async function pick(ctx: Ctx, user: User, input: { level: number; vavp: VavpId; topicId?: string | null }) {
  const { unlocks, growth } = await evaluate(ctx, user);
  const u = unlocks.find((x) => x.level === input.level);
  if (!u) throw new HttpError(409, 'level_not_reached', 'This level is not reached yet');
  if (u.pick) throw new HttpError(409, 'already_picked', 'You already chose for this level');
  const opt = optionsAt(growth, input.level).find((o) => o.vavp === input.vavp);
  if (!opt) throw new HttpError(422, 'not_offered', 'That is not offered at this level');
  let topicId: string | null = null;
  if (input.vavp !== 'vavp3') {
    const topics = await topicsFor(ctx, user);
    if (!input.topicId || !topics.some((t) => t._id === input.topicId)) throw new HttpError(422, 'validation_failed', 'Choose one of your topics');
    topicId = input.topicId;
  }
  // Claim the pick atomically: a double click or two tabs cannot pick twice.
  const claimed = await ctx.store.levelUnlocks.findOneAndUpdate({ _id: u._id, pick: null }, { $set: { pick: { vavp: input.vavp, topicId, amount: opt.amount, at: ctx.now() } } });
  if (!claimed) throw new HttpError(409, 'already_picked', 'You already chose for this level');
  const kind = input.vavp === 'vavp1' ? 'slots' : input.vavp === 'vavp2' ? 'items' : 'own_topic';
  const ent = await ctx.store.entitlements.insertOne({
    _id: newId('ent_'), userId: user._id, kind, topicId, amount: input.vavp === 'vavp3' ? 1 : opt.amount, source: 'level', sourceRef: `L${input.level}`,
    startsAt: ctx.now(), expiresAt: null, revokedAt: null, meta: input.vavp === 'vavp3' ? { visibility: 'any' } : {},
  });
  if (kind === 'items' && topicId) await applyItems(ctx, user, topicId);
  return { unlock: claimed, entitlement: ent };
}

/** More quotes apply to courses already running on that topic, not only to new ones. */
export async function applyItems(ctx: Ctx, user: User, topicId: string) {
  const topic = (await ctx.platform.topics()).find((t) => t._id === topicId);
  if (!topic) return;
  const lim = (await limitsFor(ctx, user, [topic])).perTopic[topicId];
  for (const e of await ctx.platform.enrolments(user._id)) {
    if (e.topicId === topicId && (e.status === 'active' || e.status === 'paused') && (e.maxItems ?? 0) < lim.maxItems) {
      await ctx.platform.patchEnrolment(user._id, e.id, { maxItems: lim.maxItems });
    }
  }
}

// ---- referrals

const allWindows = new WeakMap<object, Map<string, { n: number; until: number }>>();
/** At most `limit` calls per key per minute (in memory, per api instance). */
export function rateLimit(ctx: Ctx, key: string, limit: number, nowMs: number) {
  let windows = allWindows.get(ctx);
  if (!windows) { windows = new Map(); allWindows.set(ctx, windows); }
  const w = windows.get(key);
  if (!w || w.until < nowMs) { windows.set(key, { n: 1, until: nowMs + 60_000 }); return; }
  if (++w.n > limit) throw new HttpError(429, 'rate_limited', 'Too many requests, try again in a minute');
}

/**
 * A visit counts once per (link, device), and never from a device the link's owner has used. The device id is a random
 * value the browser keeps (not a fingerprint); the IP is kept only as a salted hash, for abuse checks.
 */
export async function recordVisit(ctx: Ctx, input: { code: string; deviceId: string; ip: string; viewerId: string | null }) {
  const owner = await ctx.store.users.findOne({ referralCode: input.code });
  if (!owner) return { counted: false, reason: 'unknown_code' as const };
  if (input.viewerId === owner._id || (owner.deviceIds ?? []).includes(input.deviceId)) return { counted: false, reason: 'own_device' as const };
  const ipHash = createHash('sha256').update(`${ctx.config.sessionSecret}:${input.ip}`).digest('hex').slice(0, 32);
  try {
    await ctx.store.refVisits.insertOne({ _id: newId('rv_'), code: input.code, ownerId: owner._id, deviceId: input.deviceId, ipHash, at: ctx.now() });
  } catch (e) { if (e instanceof DuplicateKeyError) return { counted: false, reason: 'already_counted' as const }; throw e; }
  return { counted: true, reason: null };
}
