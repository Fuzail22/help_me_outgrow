import type { RequestHandler, Router } from 'express';
import { z } from 'zod';
import type { Ctx } from '../context.js';
import { h, HttpError, parse } from '../http.js';
import { newId } from '../ids.js';
import { sessionUser } from '../session.js';
import { getSettings } from '../settings.js';
import { activeEntitlements, topicsFor } from '../limits.js';
import { applyItems } from '../growth.js';
import { DuplicateKeyError } from '../store/types.js';
import { PaymentError, type WebhookResult } from '../payments/index.js';
import { assertTopic, catalog, channelFor, countryOf, products, priceOf, termFor, type Family } from '../payments/catalog.js';
import type { AdminRole, Order } from '../store/schema.js';

const addMonths = (d: Date, m: number) => { const x = new Date(d); x.setUTCMonth(x.getUTCMonth() + m); return x; };

async function bumpCounter(ctx: Ctx, id: string): Promise<number> {
  for (let i = 0; i < 5; i++) {
    const c = await ctx.store.counters.findOneAndUpdate({ _id: id }, { $inc: { count: 1 } });
    if (c) return c.count;
    try { await ctx.store.counters.insertOne({ _id: id, count: 1 }); return 1; } catch (e) { if (!(e instanceof DuplicateKeyError)) throw e; }
  }
  throw new Error('counter contention');
}

/**
 * Grants what was paid for, exactly once per order: the status flip created → paid is atomic, so a checkout callback
 * and a webhook arriving together cannot both grant. The buyer number (per product family) decides how long it lasts.
 */
export async function fulfil(ctx: Ctx, orderId: string, paymentId: string | null) {
  const now = ctx.now();
  const o = await ctx.store.orders.findOneAndUpdate({ _id: orderId, status: { $in: ['created', 'failed'] } }, { $set: { status: 'paid', paidAt: now, providerPaymentId: paymentId } });
  if (!o) return ctx.store.orders.findOne({ _id: orderId });
  const pricing = await getSettings(ctx, 'pricing');
  const product = products(pricing).find((p) => p.id === o.product)!;
  const rank = await bumpCounter(ctx, product.family as Family);
  const months = termFor(pricing, rank);
  await ctx.store.entitlements.insertOne({
    _id: newId('ent_'), userId: o.userId, kind: product.kind, topicId: o.topicId, amount: product.amount, source: 'purchase', sourceRef: o._id,
    startsAt: now, expiresAt: addMonths(now, months), revokedAt: null, meta: product.visibility ? { visibility: product.visibility } : {},
  });
  const done = await ctx.store.orders.findOneAndUpdate({ _id: o._id }, { $set: { rank, termMonths: months } });
  ctx.log({ msg: 'order_paid', orderId: o._id, product: o.product, rank, months });
  if (product.kind === 'items' && o.topicId) {
    const user = await ctx.store.users.findOne({ _id: o.userId });
    if (user) await applyItems(ctx, user, o.topicId).catch((e) => ctx.log({ level: 'warn', msg: 'apply_items_failed', error: String(e) }));
  }
  return done;
}

export function upgradeRoutes(ctx: Ctx, api: Router) {
  const tzOf = (q: unknown) => (typeof q === 'string' && q.length < 64 ? q : undefined);
  api.get('/api/upgrade/catalog', h(async (req, res) => {
    const user = await sessionUser(ctx, req);
    const topicId = typeof req.query.topicId === 'string' ? req.query.topicId : null;
    const c = await catalog(ctx, user, countryOf(req.headers, tzOf(req.query.tz)), topicId);
    const mine = (await activeEntitlements(ctx, user._id)).filter((e) => e.source === 'purchase');
    const soon = ctx.now().getTime() + 3 * 86400000;
    res.json({ ...c, mine: mine.map((e) => ({ id: e._id, kind: e.kind, topicId: e.topicId, amount: e.amount, expiresAt: e.expiresAt, endingSoon: !!e.expiresAt && e.expiresAt.getTime() < soon })) });
  }));
  api.post('/api/upgrade/orders', h(async (req, res) => {
    const user = await sessionUser(ctx, req);
    const b = parse(z.object({ product: z.string().max(40), topicId: z.string().max(64).nullish(), tz: z.string().max(64).optional() }), req.body);
    const pricing = await getSettings(ctx, 'pricing');
    const product = products(pricing).find((p) => p.id === b.product);
    if (!product) throw new HttpError(404, 'not_found', 'No such product');
    assertTopic(await topicsFor(ctx, user), product, b.topicId);
    const ch = channelFor(ctx, pricing, countryOf(req.headers, b.tz));
    if (!ch) throw new HttpError(409, 'not_available_here', 'Payments are not available in your country yet; join the waitlist');
    const price = await priceOf(ctx, user, pricing, product, ch.currency, product.needsTopic ? b.topicId! : null);
    if (!('amountMinor' in price)) throw new HttpError(409, 'not_available', price.unavailable);
    const order: Order = {
      _id: newId('ord_'), userId: user._id, product: product.id, topicId: product.needsTopic ? b.topicId! : null, units: product.amount, amountMinor: price.amountMinor, currency: ch.currency,
      provider: ch.provider.name, providerOrderId: null, providerPaymentId: null, status: 'created', rank: null, termMonths: null, createdAt: ctx.now(), paidAt: null,
    };
    await ctx.store.orders.insertOne(order);
    try {
      const r = await ch.provider.createOrder({ orderId: order._id, amountMinor: order.amountMinor, currency: order.currency, description: product.title, email: user.email, name: user.name, returnUrl: `${ctx.config.appOrigin}/upgrade/done` });
      await ctx.store.orders.updateOne({ _id: order._id }, { $set: { providerOrderId: r.providerOrderId } });
      res.status(201).json({ orderId: order._id, provider: ch.provider.name, amountMinor: order.amountMinor, currency: order.currency, checkout: r.checkout });
    } catch (e) {
      await ctx.store.orders.updateOne({ _id: order._id }, { $set: { status: 'failed' } });
      throw e instanceof PaymentError ? new HttpError(502, e.code, 'The payment provider is not answering; please try again') : e;
    }
  }));
  const mineOrder = async (req: Parameters<typeof sessionUser>[1], id: string) => {
    const user = await sessionUser(ctx, req);
    const o = await ctx.store.orders.findOne({ _id: id, userId: user._id });
    if (!o) throw new HttpError(404, 'not_found', 'Order not found');
    return o;
  };
  const view = (o: Order) => ({ id: o._id, product: o.product, status: o.status, amountMinor: o.amountMinor, currency: o.currency, termMonths: o.termMonths, rank: o.rank, paidAt: o.paidAt });
  api.get('/api/upgrade/orders/:id', h(async (req, res) => { res.json(view(await mineOrder(req, req.params.id))); }));
  /** Razorpay checkout's handler posts its signed result here; the signature is checked before anything is granted. */
  api.post('/api/upgrade/orders/:id/verify', h(async (req, res) => {
    const o = await mineOrder(req, req.params.id);
    const p = o.provider === 'razorpay' ? ctx.payments.razorpay : null;
    if (!p?.verifyClient || !o.providerOrderId) throw new HttpError(409, 'not_verifiable', 'This order is confirmed by the provider directly');
    let paymentId: string;
    try { paymentId = p.verifyClient(o.providerOrderId, req.body ?? {}).paymentId; } catch (e) {
      if (e instanceof PaymentError) throw new HttpError(400, e.code, e.message);
      throw e;
    }
    res.json(view((await fulfil(ctx, o._id, paymentId))!));
  }));

  const webhook = (name: 'razorpay' | 'stripe') => h(async (req, res) => {
    const p = ctx.payments[name];
    if (!p?.parseWebhook) throw new HttpError(404, 'not_found', 'No such route');
    let r: WebhookResult | null;
    try { r = p.parseWebhook((req as any).rawBody ?? Buffer.from(''), req.headers as Record<string, string>, ctx.now().getTime()); } catch (e) {
      if (e instanceof PaymentError) { ctx.log({ level: 'warn', msg: 'webhook_rejected', provider: name, code: e.code }); throw new HttpError(400, e.code, e.message); }
      throw e;
    }
    if (r?.providerOrderId) {
      const o = await ctx.store.orders.findOne({ providerOrderId: r.providerOrderId, provider: name });
      if (o && r.status === 'paid') await fulfil(ctx, o._id, r.paymentId);
      if (o && r.status === 'failed') await ctx.store.orders.updateOne({ _id: o._id, status: 'created' }, { $set: { status: 'failed' } });
    }
    res.json({ received: true });
  });
  api.post('/api/payments/webhook/razorpay', webhook('razorpay'));
  api.post('/api/payments/webhook/stripe', webhook('stripe'));

  /** Development and tests only: the mock checkout page's Pay / Fail buttons. */
  api.post('/api/payments/mock/:id', h(async (req, res) => {
    if (!ctx.payments.mock) throw new HttpError(404, 'not_found', 'No such route');
    const o = await mineOrder(req, req.params.id);
    if (o.provider !== 'mock') throw new HttpError(409, 'not_mock', 'Not a mock order');
    const { result } = parse(z.object({ result: z.enum(['paid', 'failed']) }), req.body);
    if (result === 'failed') { await ctx.store.orders.updateOne({ _id: o._id, status: 'created' }, { $set: { status: 'failed' } }); return res.json(view((await ctx.store.orders.findOne({ _id: o._id }))!)); }
    res.json(view((await fulfil(ctx, o._id, `mockpay_${o._id}`))!));
  }));

  api.post('/api/upgrade/waitlist', h(async (req, res) => {
    const b = parse(z.object({ email: z.string().trim().toLowerCase().email().max(254), country: z.string().max(2).default('XX') }), req.body);
    await ctx.store.waitlist.insertOne({ _id: newId('wl_'), email: b.email, country: b.country, at: ctx.now() }).catch((e) => { if (!(e instanceof DuplicateKeyError)) throw e; });
    res.status(201).json({ ok: true });
  }));
}

export function orderAdminRoutes(ctx: Ctx) {
  return (api: Router, need: (r: AdminRole) => RequestHandler) => {
    api.get('/api/admin/orders', need('viewer'), h(async (req, res) => {
      const status = ['created', 'paid', 'failed'].includes(String(req.query.status)) ? { status: String(req.query.status) } : {};
      const orders = await ctx.store.orders.find(status, { sort: { createdAt: -1 }, limit: 200 });
      const users = new Map((await ctx.store.users.find({ _id: { $in: orders.map((o) => o.userId) } })).map((u) => [u._id, u.email]));
      const counters = await ctx.store.counters.find({});
      res.json({ orders: orders.map((o) => ({ ...o, email: users.get(o.userId) ?? '(deleted)' })), buyers: Object.fromEntries(counters.map((c) => [c._id, c.count])), waitlist: await ctx.store.waitlist.count({}) });
    }));
  };
}
