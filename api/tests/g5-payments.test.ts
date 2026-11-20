import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createHmac } from 'node:crypto';
import { ORIGIN, setup } from './helpers.js';
import { createPayments } from '../src/payments/index.js';
import { ladderPrice, termFor } from '../src/payments/catalog.js';
import { DEFAULTS } from '../src/settings.js';

const KEY_SECRET = 'rzp_secret_test'; const RZP_WH = 'rzp_webhook_secret'; const STRIPE_WH = 'whsec_test';
const hmac = (secret: string, data: string) => createHmac('sha256', secret).update(data).digest('hex');

async function shop(opts: { razorpay?: boolean; stripe?: boolean; mock?: boolean } = { razorpay: true, stripe: true }) {
  const s = await setup();
  const created: any[] = [];
  const fakeFetch = (async (url: string, init: any) => {
    created.push({ url, body: init.body });
    if (url.includes('razorpay')) return { ok: true, status: 200, json: async () => ({ id: `order_rzp_${created.length}` }) };
    return { ok: true, status: 200, json: async () => ({ id: `cs_test_${created.length}`, url: `https://checkout.stripe.test/${created.length}` }) };
  }) as any;
  s.ctx.payments = createPayments({
    razorpay: opts.razorpay ? { keyId: 'rzp_test_key', keySecret: KEY_SECRET, webhookSecret: RZP_WH, fetch: fakeFetch } : null,
    stripe: opts.stripe ? { secretKey: 'sk_test_x', webhookSecret: STRIPE_WH, fetch: fakeFetch } : null,
    mockOrigin: opts.mock ? ORIGIN : null,
  });
  const loss = s.platform.addTopic({ slug: 'loss' }, 200);
  return { s, created, loss };
}
const india = { tz: 'Asia/Kolkata' };

describe('G5: prices and terms', () => {
  it('VAVP3 ladder: ₹50 for buyers 1–10, +₹10 per 10 buyers, flat after 200; terms 12/6/3/1 months by buyer number', () => {
    const l = DEFAULTS.pricing.vavp3.private;
    expect([1, 10, 11, 20, 21, 191, 200, 201, 500].map((r) => ladderPrice(l, r) / 100)).toEqual([50, 50, 60, 60, 70, 240, 240, 240, 240]);
    expect([1, 10, 11, 20, 21, 70, 71, 1000].map((r) => termFor(DEFAULTS.pricing, r))).toEqual([12, 12, 6, 6, 3, 3, 1, 1]);
  });
  it('India gets rupees through Razorpay; the n-th extra notification on a topic costs ₹10, ₹50, ₹100; a bundle of 3 is ₹109', async () => {
    const { s, loss } = await shop();
    const a = await s.signIn('Asha'); const c = s.as(a.cookie);
    const cat = (await c.get(`/api/upgrade/catalog?tz=Asia/Kolkata&topicId=${loss._id}`).expect(200)).body;
    expect(cat).toMatchObject({ country: 'IN', provider: 'razorpay', currency: 'INR' });
    const price = (id: string) => cat.products.find((p: any) => p.id === id);
    expect([price('vavp1_unit').amountMinor, price('vavp1_bundle3').amountMinor, price('vavp2_0').amountMinor, price('vavp2_1').amountMinor, price('vavp3_private').amountMinor, price('vavp3_public').amountMinor])
      .toEqual([1000, 10900, 1000, 5000, 5000, 10000]);
    expect(price('vavp1_unit')).toMatchObject({ rank: 1, months: 12 });
  });
  it('a CDN country header wins over the time zone; outside India it is Stripe in dollars, or a waitlist when switched off', async () => {
    const { s } = await shop();
    const a = await s.signIn('Asha');
    const us = (await request(s.app).get('/api/upgrade/catalog?tz=Asia/Kolkata').set('cookie', a.cookie).set('cf-ipcountry', 'US').expect(200)).body;
    expect(us).toMatchObject({ country: 'US', provider: 'stripe', currency: 'USD' });
    s.ctx.config.adminOwnerEmail = 'owner@dev.invalid';
    const owner = s.as((await s.signIn('Owner')).cookie);
    await owner.put('/api/admin/settings/pricing', { ...DEFAULTS.pricing, international: false }).set({ 'x-admin': '1' }).expect(200);
    const off = (await s.as(a.cookie).get('/api/upgrade/catalog?tz=Europe/Berlin').expect(200)).body;
    expect(off).toMatchObject({ available: false, waitlist: true });
    await s.as(a.cookie).post('/api/upgrade/orders', { product: 'vavp2_0', topicId: 'x', tz: 'Europe/Berlin' }).expect(422);
    await s.as(a.cookie).post('/api/upgrade/waitlist', { email: 'asha@example.test', country: 'DE' }).expect(201);
    await s.as(a.cookie).post('/api/upgrade/waitlist', { email: 'asha@example.test', country: 'DE' }).expect(201);
    expect(await s.ctx.store.waitlist.count({})).toBe(1);
  });
});

describe('G5: Razorpay', () => {
  it('creates the order on the server (amount from settings), verifies the checkout signature, and grants once', async () => {
    const { s, created, loss } = await shop();
    const a = await s.signIn('Asha'); const c = s.as(a.cookie);
    const o = (await c.post('/api/upgrade/orders', { product: 'vavp1_unit', topicId: loss._id, amountMinor: 1, ...india }).expect(201)).body;
    expect(o).toMatchObject({ provider: 'razorpay', amountMinor: 1000, currency: 'INR', checkout: { keyId: 'rzp_test_key', orderId: 'order_rzp_1', amount: 1000 } });
    expect(JSON.parse(created[0].body)).toMatchObject({ amount: 1000, currency: 'INR', receipt: o.orderId });
    const bad = { razorpay_order_id: 'order_rzp_1', razorpay_payment_id: 'pay_1', razorpay_signature: 'forged' };
    expect((await c.post(`/api/upgrade/orders/${o.orderId}/verify`, bad).expect(400)).body.error.code).toBe('bad_signature');
    const good = { ...bad, razorpay_signature: hmac(KEY_SECRET, 'order_rzp_1|pay_1') };
    expect((await c.post(`/api/upgrade/orders/${o.orderId}/verify`, good).expect(200)).body).toMatchObject({ status: 'paid', rank: 1, termMonths: 12 });
    await c.post(`/api/upgrade/orders/${o.orderId}/verify`, good).expect(200); // replay: no second grant
    const ents = await s.ctx.store.entitlements.find({ userId: a.id });
    expect(ents).toHaveLength(1);
    expect(ents[0]).toMatchObject({ kind: 'slots', topicId: loss._id, amount: 1, source: 'purchase' });
    expect(ents[0].expiresAt!.toISOString().slice(0, 10)).toBe('2027-11-20');
    expect((await c.get('/api/me/limits').expect(200)).body.perTopic[loss._id].maxSlots).toBe(4);
    // The second extra notification on the same topic now costs ₹50.
    const cat = (await c.get(`/api/upgrade/catalog?tz=Asia/Kolkata&topicId=${loss._id}`).expect(200)).body;
    expect(cat.products.find((p: any) => p.id === 'vavp1_unit').amountMinor).toBe(5000);
    expect(cat.mine).toHaveLength(1);
  });
  it('the webhook (signed over the raw body) grants too, and only once with the checkout callback', async () => {
    const { s, loss } = await shop();
    const a = await s.signIn('Asha'); const c = s.as(a.cookie);
    const o = (await c.post('/api/upgrade/orders', { product: 'vavp2_1', topicId: loss._id, ...india }).expect(201)).body;
    const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_9', order_id: o.checkout.orderId } } } });
    await request(s.app).post('/api/payments/webhook/razorpay').set('content-type', 'application/json').set('x-razorpay-signature', 'nope').send(body).expect(400);
    await request(s.app).post('/api/payments/webhook/razorpay').set('content-type', 'application/json').set('x-razorpay-signature', hmac(RZP_WH, body)).send(body).expect(200);
    await request(s.app).post('/api/payments/webhook/razorpay').set('content-type', 'application/json').set('x-razorpay-signature', hmac(RZP_WH, body)).send(body).expect(200);
    await c.post(`/api/upgrade/orders/${o.orderId}/verify`, { razorpay_order_id: o.checkout.orderId, razorpay_payment_id: 'pay_9', razorpay_signature: hmac(KEY_SECRET, `${o.checkout.orderId}|pay_9`) }).expect(200);
    expect(await s.ctx.store.entitlements.count({ userId: a.id })).toBe(1);
    expect((await c.get('/api/me/limits').expect(200)).body.perTopic[loss._id].maxItems).toBe(110);
  });
  it('buyer numbers are counted per product: the 11th VAVP3 buyer pays ₹60 and gets 6 months', async () => {
    const { s } = await shop({ razorpay: true });
    for (let i = 1; i <= 11; i++) {
      const u = await s.signIn(`Buyer ${i}`); const c = s.as(u.cookie);
      const o = (await c.post('/api/upgrade/orders', { product: 'vavp3_private', tz: 'Europe/Paris' }).set('cf-ipcountry', 'IN').expect(201)).body;
      expect(o.amountMinor).toBe(i <= 10 ? 5000 : 6000);
      const sig = hmac(KEY_SECRET, `${o.checkout.orderId}|pay_${i}`);
      const r = (await c.post(`/api/upgrade/orders/${o.orderId}/verify`, { razorpay_order_id: o.checkout.orderId, razorpay_payment_id: `pay_${i}`, razorpay_signature: sig }).expect(200)).body;
      expect(r).toMatchObject({ rank: i, termMonths: i <= 10 ? 12 : 6 });
    }
    // Another product's count is separate.
    const u = await s.signIn('Other'); const c = s.as(u.cookie);
    expect((await c.get('/api/upgrade/catalog?tz=Asia/Kolkata').expect(200)).body.products.find((p: any) => p.id === 'vavp3_public')).toMatchObject({ rank: 1, months: 12, amountMinor: 10000 });
  });
});

describe('G5: Stripe and the mock', () => {
  it('Stripe Checkout: redirect URL from the session; the signed webhook grants; a stale or forged one is refused', async () => {
    const { s, created } = await shop();
    const a = await s.signIn('Asha'); const c = s.as(a.cookie);
    const o = (await c.post('/api/upgrade/orders', { product: 'vavp3_public', tz: 'America/New_York' }).expect(201)).body;
    expect(o).toMatchObject({ provider: 'stripe', currency: 'USD', amountMinor: 799, checkout: { url: expect.stringContaining('checkout.stripe.test') } });
    expect(new URLSearchParams(created[0].body).get('line_items[0][price_data][unit_amount]')).toBe('799');
    const ev = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_test_1', payment_status: 'paid', payment_intent: 'pi_1' } } });
    const t = Math.floor(s.clock.now().getTime() / 1000);
    const sign = (ts: number) => `t=${ts},v1=${hmac(STRIPE_WH, `${ts}.${ev}`)}`;
    await request(s.app).post('/api/payments/webhook/stripe').set('content-type', 'application/json').set('stripe-signature', sign(t - 3600)).send(ev).expect(400);
    await request(s.app).post('/api/payments/webhook/stripe').set('content-type', 'application/json').set('stripe-signature', `t=${t},v1=deadbeef`).send(ev).expect(400);
    await request(s.app).post('/api/payments/webhook/stripe').set('content-type', 'application/json').set('stripe-signature', sign(t)).send(ev).expect(200);
    expect((await c.get(`/api/upgrade/orders/${o.orderId}`).expect(200)).body).toMatchObject({ status: 'paid', rank: 1, termMonths: 12 });
    expect(await s.ctx.store.entitlements.findOne({ userId: a.id })).toMatchObject({ kind: 'own_topic', meta: { visibility: 'public' } });
  });
  it('the mock checkout pays or fails an order (dev only), and someone else’s order is not found', async () => {
    const { s } = await shop({ mock: true });
    const a = await s.signIn('Asha'); const b = await s.signIn('Bea');
    const o = (await s.as(a.cookie).post('/api/upgrade/orders', { product: 'vavp3_private', ...india }).expect(201)).body;
    expect(o.checkout.url).toBe(`${ORIGIN}/upgrade/mock/${o.orderId}`);
    await s.as(b.cookie).post(`/api/payments/mock/${o.orderId}`, { result: 'paid' }).expect(404);
    expect((await s.as(a.cookie).post(`/api/payments/mock/${o.orderId}`, { result: 'paid' }).expect(200)).body.status).toBe('paid');
    const s2 = await shop({ razorpay: true });
    const u = await s2.s.signIn('X');
    await s2.s.as(u.cookie).post('/api/payments/mock/anything', { result: 'paid' }).expect(404);
  });
});
