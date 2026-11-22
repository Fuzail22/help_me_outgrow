import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Payment providers behind one small interface. The server prices every order; providers only collect the money.
 * An order is fulfilled only after a verified signature (Razorpay checkout callback) or a verified webhook (both
 * providers); fulfilment is idempotent, so a callback and a webhook for the same payment grant once.
 */
export interface CreateInput { orderId: string; amountMinor: number; currency: 'INR' | 'USD'; description: string; email: string; name: string; returnUrl: string }
export interface WebhookResult { providerOrderId: string; paymentId: string | null; status: 'paid' | 'failed' }
export interface Provider {
  name: 'razorpay' | 'stripe' | 'mock';
  createOrder(i: CreateInput): Promise<{ providerOrderId: string; checkout: Record<string, unknown> }>;
  /** Razorpay only: the browser hands back order id, payment id and signature after checkout. */
  verifyClient?(providerOrderId: string, body: Record<string, unknown>): { paymentId: string };
  parseWebhook?(raw: Buffer, headers: Record<string, string | undefined>, nowMs: number): WebhookResult | null;
}
export interface Payments {
  razorpay: Provider | null; stripe: Provider | null; mock: Provider | null;
  /** Razorpay also takes international cards (USD) once "International payments" is activated on the account. */
  razorpayInternational: boolean;
  enabled: { razorpay: boolean; stripe: boolean; mock: boolean };
}

export class PaymentError extends Error { constructor(public code: string, message: string) { super(message); } }
const hmacHex = (secret: string, data: string | Buffer) => createHmac('sha256', secret).update(data).digest('hex');
const same = (a: string, b: string) => { const x = Buffer.from(a); const y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

export function razorpay(o: { keyId: string; keySecret: string; webhookSecret: string | null; fetch?: typeof fetch }): Provider {
  const f = o.fetch ?? fetch;
  return {
    name: 'razorpay',
    async createOrder(i) {
      const r = await f('https://api.razorpay.com/v1/orders', {
        method: 'POST', headers: { authorization: `Basic ${Buffer.from(`${o.keyId}:${o.keySecret}`).toString('base64')}`, 'content-type': 'application/json' },
        body: JSON.stringify({ amount: i.amountMinor, currency: i.currency, receipt: i.orderId, notes: { orderId: i.orderId } }),
      });
      const b = (await r.json().catch(() => ({}))) as any;
      if (r.status === 401) throw new PaymentError('provider_auth', 'Razorpay refused the API keys: check RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET (test and live keys must not be mixed)');
      if (!r.ok || !b.id) throw new PaymentError('provider_error', b?.error?.description ?? `Razorpay answered ${r.status}`);
      // Razorpay Checkout (UPI intent/QR, cards, netbanking, wallets) opens in the page with these.
      return { providerOrderId: b.id, checkout: { keyId: o.keyId, orderId: b.id, amount: i.amountMinor, currency: i.currency, name: 'help me outgrow', description: i.description, prefill: { email: i.email, name: i.name } } };
    },
    verifyClient(providerOrderId, body) {
      const paymentId = String(body.razorpay_payment_id ?? ''); const sig = String(body.razorpay_signature ?? '');
      if (String(body.razorpay_order_id ?? '') !== providerOrderId || !paymentId || !sig) throw new PaymentError('bad_signature', 'Payment details are incomplete');
      if (!same(hmacHex(o.keySecret, `${providerOrderId}|${paymentId}`), sig)) throw new PaymentError('bad_signature', 'The payment signature did not match');
      return { paymentId };
    },
    parseWebhook(raw, headers) {
      if (!o.webhookSecret) return null;
      const sig = headers['x-razorpay-signature'] ?? '';
      if (!same(hmacHex(o.webhookSecret, raw), sig)) throw new PaymentError('bad_signature', 'Webhook signature did not match');
      const e = JSON.parse(raw.toString('utf8'));
      const p = e?.payload?.payment?.entity;
      if (e.event === 'payment.captured' || e.event === 'order.paid') return { providerOrderId: p?.order_id ?? e?.payload?.order?.entity?.id, paymentId: p?.id ?? null, status: 'paid' };
      if (e.event === 'payment.failed') return { providerOrderId: p?.order_id, paymentId: p?.id ?? null, status: 'failed' };
      return null;
    },
  };
}

export function stripe(o: { secretKey: string; webhookSecret: string | null; fetch?: typeof fetch }): Provider {
  const f = o.fetch ?? fetch;
  return {
    name: 'stripe',
    async createOrder(i) {
      const form = new URLSearchParams({
        mode: 'payment', 'line_items[0][quantity]': '1', 'line_items[0][price_data][currency]': i.currency.toLowerCase(),
        'line_items[0][price_data][unit_amount]': String(i.amountMinor), 'line_items[0][price_data][product_data][name]': i.description,
        success_url: `${i.returnUrl}?order=${i.orderId}`, cancel_url: `${i.returnUrl}?order=${i.orderId}&cancelled=1`,
        client_reference_id: i.orderId, 'metadata[orderId]': i.orderId, customer_email: i.email,
      });
      const r = await f('https://api.stripe.com/v1/checkout/sessions', { method: 'POST', headers: { authorization: `Bearer ${o.secretKey}`, 'content-type': 'application/x-www-form-urlencoded' }, body: form.toString() });
      const b = (await r.json().catch(() => ({}))) as any;
      if (!r.ok || !b.id || !b.url) throw new PaymentError('provider_error', b?.error?.message ?? `Stripe answered ${r.status}`);
      return { providerOrderId: b.id, checkout: { url: b.url } };
    },
    parseWebhook(raw, headers, nowMs) {
      if (!o.webhookSecret) return null;
      const parts = Object.fromEntries((headers['stripe-signature'] ?? '').split(',').map((kv) => kv.split('=') as [string, string]));
      const t = Number(parts.t);
      if (!t || Math.abs(nowMs / 1000 - t) > 300) throw new PaymentError('bad_signature', 'Webhook timestamp is missing or too old');
      if (!parts.v1 || !same(hmacHex(o.webhookSecret, `${t}.${raw.toString('utf8')}`), parts.v1)) throw new PaymentError('bad_signature', 'Webhook signature did not match');
      const e = JSON.parse(raw.toString('utf8'));
      const s = e?.data?.object;
      if ((e.type === 'checkout.session.completed' || e.type === 'checkout.session.async_payment_succeeded') && s?.payment_status === 'paid') return { providerOrderId: s.id, paymentId: s.payment_intent ?? null, status: 'paid' };
      if (e.type === 'checkout.session.async_payment_failed' || e.type === 'checkout.session.expired') return { providerOrderId: s?.id, paymentId: null, status: 'failed' };
      return null;
    },
  };
}

/** Development and tests only: a page in our own app stands in for the provider's checkout. */
export function mock(appOrigin: string): Provider {
  return { name: 'mock', async createOrder(i) { return { providerOrderId: `mock_${i.orderId}`, checkout: { url: `${appOrigin}/upgrade/mock/${i.orderId}` } }; } };
}

export function createPayments(o: { razorpay?: Parameters<typeof razorpay>[0] | null; stripe?: Parameters<typeof stripe>[0] | null; mockOrigin?: string | null; razorpayInternational?: boolean }): Payments {
  const r = o.razorpay ? razorpay(o.razorpay) : null; const s = o.stripe ? stripe(o.stripe) : null; const m = o.mockOrigin ? mock(o.mockOrigin) : null;
  return { razorpay: r, stripe: s, mock: m, razorpayInternational: !!(r && o.razorpayInternational), enabled: { razorpay: !!r, stripe: !!s, mock: !!m } };
}
export const noPayments: Payments = createPayments({});
