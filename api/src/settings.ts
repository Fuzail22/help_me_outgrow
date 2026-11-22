import { z } from 'zod';
import type { Ctx } from './context.js';
import { HttpError } from './http.js';
import type { SettingsDoc } from './store/schema.js';

/**
 * Everything the owner asked to be configurable lives here, as three documents edited in the admin:
 *  - limits:  the base allowance (account-age ladder, 90 quotes, 92 days) and the "about to end" notice
 *  - growth:  levels and their tasks, and what each VAVP gives at each level
 *  - pricing: paid products, prices (INR and USD), terms by buyer rank, VAVP3 price ladders
 */
const tier = z.object({ minDays: z.number().int().min(0), maxSlots: z.number().int().min(1).max(96) });
export const limitsSchema = z.object({
  baseLadder: z.array(tier).min(1).max(12).refine((t) => t[0].minDays === 0 && t.every((x, i) => i === 0 || x.minDays > t[i - 1].minDays), 'The first tier starts at day 0 and days go up'),
  baseItems: z.number().int().min(1).max(10000),
  maxDurationDays: z.number().int().min(1).max(3660),
  durations: z.array(z.object({ days: z.number().int().min(1), label: z.string().min(1).max(30) })).min(1).max(8),
  endingNotice: z.object({ withinDays: z.number().int().min(1).max(30), text: z.string().min(1).max(140) }),
  ownTopicLineCap: z.number().int().min(1).max(10000),
});
export type LimitsSettings = z.infer<typeof limitsSchema>;

const task = z.object({ type: z.enum(['ratings', 'referral_visits', 'referral_signups', 'approved_posts']), count: z.number().int().min(1).max(100000) });
const levelAmounts = z.record(z.string().regex(/^\d+$/), z.number().int().min(0).max(10000));
export const growthSchema = z.object({
  levels: z.array(z.object({ level: z.number().int().min(1), mode: z.enum(['any', 'all']), tasks: z.array(task).min(1).max(8) })).max(20)
    .refine((ls) => ls.every((l, i) => l.level === i + 1), 'Levels are numbered 1, 2, 3 … in order'),
  vavp: z.object({
    vavp1: z.object({ levels: levelAmounts, stack: z.enum(['max', 'sum']) }),
    vavp2: z.object({ levels: levelAmounts, stack: z.enum(['max', 'sum']) }),
    vavp3: z.object({ levels: levelAmounts }),
  }),
});
export type GrowthSettings = z.infer<typeof growthSchema>;

const ladder = z.object({ start: z.number().int().min(0), step: z.number().int().min(0), band: z.number().int().min(1), maxBuyers: z.number().int().min(1) });
export const pricingSchema = z.object({
  international: z.boolean(),
  vavp1Units: z.array(z.number().int().min(0)).min(1).max(10),
  vavp1Bundle3: z.number().int().min(0),
  vavp2: z.array(z.object({ items: z.number().int().min(1), price: z.number().int().min(0) })).min(1).max(6),
  vavp3: z.object({ private: ladder, public: ladder }),
  terms: z.array(z.object({ upTo: z.number().int().min(1).nullable(), months: z.number().int().min(1).max(120) })).min(1),
  usd: z.object({ vavp1Unit: z.number().int().min(0), vavp1Bundle3: z.number().int().min(0), vavp2: z.array(z.number().int().min(0)), vavp3Private: z.number().int().min(0), vavp3Public: z.number().int().min(0) }),
});
export type PricingSettings = z.infer<typeof pricingSchema>;
/** Razorpay's smallest charge is 100 subunits (₹1 or $1.00 → 100 paise or cents); 0 is allowed and means free. */
export const MIN_CHARGE = 100;
function pricesOf(p: PricingSettings): number[] {
  return [...p.vavp1Units, p.vavp1Bundle3, ...p.vavp2.map((x) => x.price), p.vavp3.private.start, p.vavp3.public.start,
    p.usd.vavp1Unit, p.usd.vavp1Bundle3, ...p.usd.vavp2, p.usd.vavp3Private, p.usd.vavp3Public];
}

export const DEFAULTS = {
  limits: {
    baseLadder: [{ minDays: 0, maxSlots: 3 }, { minDays: 30, maxSlots: 6 }, { minDays: 90, maxSlots: 12 }],
    baseItems: 90, maxDurationDays: 92,
    durations: [{ days: 7, label: '1 week' }, { days: 14, label: 'A fortnight' }, { days: 30, label: '1 month' }, { days: 92, label: '3 months' }],
    endingNotice: { withinDays: 3, text: "Notifications are about to end, choose what's next — {daysLeft} days left" },
    ownTopicLineCap: 150,
  } satisfies LimitsSettings,
  growth: {
    levels: [
      { level: 1, mode: 'any', tasks: [{ type: 'ratings', count: 9 }, { type: 'referral_visits', count: 1 }] },
      { level: 2, mode: 'any', tasks: [{ type: 'referral_signups', count: 1 }, { type: 'referral_visits', count: 10 }] },
    ],
    vavp: {
      vavp1: { levels: { 1: 1, 2: 2, 3: 3 }, stack: 'max' },
      vavp2: { levels: { 1: 3, 2: 6, 3: 9 }, stack: 'max' },
      // VAVP3's level and tasks are to be decided by the owner; until then it is only for sale.
      vavp3: { levels: {} },
    },
  } satisfies GrowthSettings,
  pricing: {
    international: true,
    // Paise. The n-th paid extra notification on one topic: ₹10, ₹50, ₹100; three at once ₹109.
    vavp1Units: [1000, 5000, 10000], vavp1Bundle3: 10900,
    vavp2: [{ items: 3, price: 1000 }, { items: 20, price: 5000 }],
    vavp3: { private: { start: 5000, step: 1000, band: 10, maxBuyers: 200 }, public: { start: 10000, step: 1000, band: 10, maxBuyers: 200 } },
    // Buyer rank per product → months: first 10 a year, next 10 six months, next 50 three, everyone after one.
    terms: [{ upTo: 10, months: 12 }, { upTo: 20, months: 6 }, { upTo: 70, months: 3 }, { upTo: null, months: 1 }],
    // Cents.
    usd: { vavp1Unit: 100, vavp1Bundle3: 299, vavp2: [100, 299], vavp3Private: 499, vavp3Public: 799 },
  } satisfies PricingSettings,
};
const SCHEMAS = { limits: limitsSchema, growth: growthSchema, pricing: pricingSchema.refine((p) => pricesOf(p).every((x) => x === 0 || x >= MIN_CHARGE), 'Every price must be at least ₹1 / $1.00 (100 paise or cents), or 0') };
export type SettingsId = keyof typeof SCHEMAS;
type Of<K extends SettingsId> = K extends 'limits' ? LimitsSettings : K extends 'growth' ? GrowthSettings : PricingSettings;

export async function getSettings<K extends SettingsId>(ctx: Ctx, id: K): Promise<Of<K>> {
  const doc = await ctx.store.settings.findOne({ _id: id });
  return { ...(DEFAULTS[id] as object), ...((doc?.data as object) ?? {}) } as Of<K>;
}

export async function putSettings(ctx: Ctx, id: SettingsId, data: unknown, actor: string) {
  const r = SCHEMAS[id].safeParse(data);
  if (!r.success) throw new HttpError(422, 'invalid_settings', r.error.issues[0]?.message ?? 'Invalid settings', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  const before = await getSettings(ctx, id);
  const doc: SettingsDoc = { _id: id, data: r.data as Record<string, unknown>, updatedAt: ctx.now(), updatedBy: actor };
  const { _id: _ignored, ...fields } = doc;
  if (!(await ctx.store.settings.updateOne({ _id: id }, { $set: fields }))) await ctx.store.settings.insertOne(doc);
  return { before, after: r.data };
}
