import type { Ctx } from '../context.js';
import { HttpError } from '../http.js';
import { getSettings, type PricingSettings } from '../settings.js';
import { activeEntitlements, topicsFor } from '../limits.js';
import type { EntitlementKind, User } from '../store/schema.js';
import type { Provider } from './index.js';

/**
 * Paid privileges. Every price is computed here from the pricing settings; the browser never sends an amount.
 * "Family" is the product as the owner counts buyers ("the first 10 buyers of VAVP1 get a year").
 */
export type Family = 'vavp1' | 'vavp2' | 'vavp3_private' | 'vavp3_public';
export interface Product { id: string; family: Family; kind: EntitlementKind; amount: number; needsTopic: boolean; title: string; text: string; visibility?: 'private' | 'public' }

export const ladderPrice = (l: PricingSettings['vavp3']['private'], rank: number) => l.start + l.step * Math.floor((Math.min(rank, l.maxBuyers) - 1) / l.band);
export const termFor = (p: PricingSettings, rank: number) => (p.terms.find((t) => t.upTo === null || rank <= t.upTo) ?? p.terms[p.terms.length - 1]).months;

export function products(p: PricingSettings): Product[] {
  return [
    { id: 'vavp1_unit', family: 'vavp1', kind: 'slots', amount: 1, needsTopic: true, title: 'One more notification a day', text: 'On one topic you choose.' },
    { id: 'vavp1_bundle3', family: 'vavp1', kind: 'slots', amount: 3, needsTopic: true, title: 'Three more notifications a day', text: 'On one topic, bought together for less.' },
    ...p.vavp2.map((x, i) => ({ id: `vavp2_${i}`, family: 'vavp2' as const, kind: 'items' as const, amount: x.items, needsTopic: true, title: `${x.items} more notes`, text: 'On one topic you choose, as far as it has notes.' })),
    { id: 'vavp3_private', family: 'vavp3_private', kind: 'own_topic', amount: 1, needsTopic: false, title: 'Your own topic, just for you', text: 'Write up to 150 notes that only you receive.', visibility: 'private' },
    { id: 'vavp3_public', family: 'vavp3_public', kind: 'own_topic', amount: 1, needsTopic: false, title: 'Your own topic, open to others', text: 'Up to 150 notes anyone may follow, after a short review.', visibility: 'public' },
  ];
}

export const INDIA_ZONES = new Set(['Asia/Kolkata', 'Asia/Calcutta']);
/** Country from a CDN header when there is one, else the browser's time zone. */
export function countryOf(headers: Record<string, string | string[] | undefined>, tz: string | undefined) {
  const h = ['cf-ipcountry', 'x-vercel-ip-country', 'x-country', 'fly-client-country'].map((k) => headers[k]).find((v) => typeof v === 'string' && /^[A-Z]{2}$/.test(v)) as string | undefined;
  if (h) return h;
  return tz && INDIA_ZONES.has(tz) ? 'IN' : tz ? 'XX' : 'IN';
}

/** Which provider and currency serve this country, or null (international sales off: waitlist). */
export function channelFor(ctx: Ctx, pricing: PricingSettings, country: string): { provider: Provider; currency: 'INR' | 'USD' } | null {
  const { razorpay, stripe, mock, razorpayInternational } = ctx.payments;
  if (country === 'IN') { const p = razorpay ?? mock; return p ? { provider: p, currency: 'INR' } : null; }
  if (!pricing.international) return null;
  // Outside India: Razorpay's international cards in USD (no Stripe needed), else Stripe if configured.
  const p = (razorpayInternational ? razorpay : null) ?? stripe ?? mock;
  return p ? { provider: p, currency: 'USD' } : null;
}

async function paidUnitsOn(ctx: Ctx, userId: string, topicId: string) {
  return (await activeEntitlements(ctx, userId, 'slots')).filter((e) => e.source === 'purchase' && e.topicId === topicId).reduce((a, e) => a + e.amount, 0);
}
export async function nextRank(ctx: Ctx, family: Family) { return ((await ctx.store.counters.findOne({ _id: family }))?.count ?? 0) + 1; }

/** Price of one product for this person now (null = not available, with the reason). */
export async function priceOf(ctx: Ctx, user: User, p: PricingSettings, product: Product, currency: 'INR' | 'USD', topicId: string | null): Promise<{ amountMinor: number } | { unavailable: string }> {
  if (product.family === 'vavp1') {
    if (!topicId) return { amountMinor: currency === 'INR' ? p.vavp1Units[0] : p.usd.vavp1Unit };
    const have = await paidUnitsOn(ctx, user._id, topicId);
    if (product.id === 'vavp1_bundle3') {
      if (have + 3 > p.vavp1Units.length) return { unavailable: `At most ${p.vavp1Units.length} paid extra notifications on one topic` };
      return { amountMinor: currency === 'INR' ? p.vavp1Bundle3 : p.usd.vavp1Bundle3 };
    }
    if (have >= p.vavp1Units.length) return { unavailable: `At most ${p.vavp1Units.length} paid extra notifications on one topic` };
    return { amountMinor: currency === 'INR' ? p.vavp1Units[have] : p.usd.vavp1Unit };
  }
  if (product.family === 'vavp2') {
    const i = Number(product.id.split('_')[1]);
    return { amountMinor: currency === 'INR' ? p.vavp2[i].price : (p.usd.vavp2[i] ?? p.usd.vavp2[0] ?? 100) };
  }
  const vis = product.visibility!;
  const rank = await nextRank(ctx, product.family);
  if (currency === 'USD') return { amountMinor: vis === 'private' ? p.usd.vavp3Private : p.usd.vavp3Public };
  return { amountMinor: ladderPrice(p.vavp3[vis], rank) };
}

export async function catalog(ctx: Ctx, user: User, country: string, topicId: string | null) {
  const pricing = await getSettings(ctx, 'pricing');
  const ch = channelFor(ctx, pricing, country);
  const topics = (await topicsFor(ctx, user)).map((t) => ({ id: t._id, title: t.title }));
  if (!ch) return { country, available: false as const, waitlist: true, topics, products: [] };
  const list = [];
  for (const prod of products(pricing)) {
    const rank = await nextRank(ctx, prod.family);
    const price = await priceOf(ctx, user, pricing, prod, ch.currency, prod.needsTopic ? topicId : null);
    list.push({ ...prod, ...('amountMinor' in price ? { amountMinor: price.amountMinor, unavailable: null } : { amountMinor: null, unavailable: price.unavailable }), rank, months: termFor(pricing, rank) });
  }
  return { country, available: true as const, waitlist: false, provider: ch.provider.name, currency: ch.currency, topics, products: list };
}

export function assertTopic(topics: { _id: string }[], product: Product, topicId: string | null | undefined) {
  if (product.needsTopic && (!topicId || !topics.some((t) => t._id === topicId))) throw new HttpError(422, 'validation_failed', 'Choose one of your topics');
}
