import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../lib/ns';
import { useSession } from '../lib/session';
import { SignIn } from '../components/SignIn';
import { browserTimezone, formatDate } from '../lib/time';

interface Product { id: string; family: string; title: string; text: string; needsTopic: boolean; amountMinor: number | null; unavailable: string | null; rank: number; months: number }
interface Catalog { country: string; available: boolean; waitlist: boolean; provider?: 'razorpay' | 'stripe' | 'mock'; currency?: 'INR' | 'USD'; topics: { id: string; title: string }[]; products: Product[]; mine: { id: string; kind: string; topicId: string | null; amount: number; expiresAt: string | null; endingSoon: boolean }[] }
interface Order { orderId: string; provider: string; amountMinor: number; currency: string; checkout: any }
export const money = (minor: number, currency = 'INR') => (currency === 'INR' ? `₹${(minor / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : `$${(minor / 100).toFixed(2)}`);
const term = (m: number) => (m % 12 === 0 ? `${m / 12} year${m > 12 ? 's' : ''}` : `${m} month${m > 1 ? 's' : ''}`);
const KIND: Record<string, string> = { slots: 'more notifications a day', items: 'more notes', own_topic: 'own topic' };

function loadRazorpay(): Promise<void> {
  if ((window as any).Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = 'https://checkout.razorpay.com/v1/checkout.js'; s.onload = () => resolve(); s.onerror = () => reject(new Error('Could not load the payment window')); document.head.appendChild(s); });
}

/** /upgrade: paid privileges, on their own page (what is earned by levels lives on /growth). */
export function Upgrade() {
  const { user, setUser } = useSession();
  const navigate = useNavigate();
  const [topicId, setTopicId] = useState('');
  const [cat, setCat] = useState<Catalog | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState(''); const [joined, setJoined] = useState(false);
  const load = (t = topicId) => api<Catalog>('GET', `/api/upgrade/catalog?tz=${encodeURIComponent(browserTimezone())}${t ? `&topicId=${t}` : ''}`).then(setCat);
  useEffect(() => { if (user) void load(); }, [user]);
  if (user === undefined) return <p className="muted" aria-busy="true">Loading…</p>;
  if (!user) return <section><h1>Upgrade</h1><SignIn onSignedIn={setUser} /></section>;
  if (!cat) return <p className="muted" aria-busy="true">Loading…</p>;

  const buy = async (p: Product) => {
    setBusy(p.id); setError(null);
    try {
      const o = await api<Order>('POST', '/api/upgrade/orders', { product: p.id, topicId: p.needsTopic ? topicId : null, tz: browserTimezone() });
      if (o.provider === 'razorpay') {
        await loadRazorpay();
        const rzp = new (window as any).Razorpay({
          key: o.checkout.keyId, order_id: o.checkout.orderId, amount: o.checkout.amount, currency: o.checkout.currency, name: o.checkout.name, description: o.checkout.description,
          prefill: o.checkout.prefill, theme: { color: '#2f6f6a' },
          handler: async (r: Record<string, string>) => {
            setError(null);
            try { await api('POST', `/api/upgrade/orders/${o.orderId}/verify`, r); }
            catch { /* the webhook still confirms a genuine payment; the next page waits for it */ }
            navigate(`/upgrade/done?order=${o.orderId}`);
          },
          modal: { ondismiss: () => { setBusy(null); setError((x) => x ?? 'Payment window closed. Nothing was charged.'); } },
        });
        // A declined card or a failed UPI attempt: Razorpay keeps the window open so the person can retry; tell them why.
        rzp.on('payment.failed', (r: { error?: { description?: string; reason?: string } }) => {
          setError(`The payment did not go through${r.error?.description ? `: ${r.error.description}` : ''}. You can try again or use another method.`);
        });
        rzp.open();
        return;
      }
      location.assign(o.checkout.url); // Stripe Checkout, or the local mock page
    } catch (e: any) { setError(e.message); setBusy(null); }
  };
  const c = cat.currency ?? 'INR';
  return (
    <section className="upgrade">
      <h1>Upgrade</h1>
      <p className="lede">Paid privileges, if you would like more now. Everything here can also be earned by helping the app grow, on <Link to="/growth">Grow with us</Link>.</p>
      {cat.mine.length > 0 && (
        <div className="callout">
          <strong>What you have</strong>
          <ul>{cat.mine.map((m) => <li key={m.id}>+{m.amount} {KIND[m.kind]}{m.topicId ? ` on ${cat.topics.find((t) => t.id === m.topicId)?.title ?? 'a topic'}` : ''}{m.expiresAt ? `, until ${formatDate(m.expiresAt.slice(0, 10))}` : ''}{m.endingSoon ? ' — ends in under 3 days' : ''}</li>)}</ul>
        </div>
      )}
      {!cat.available ? (
        <div className="callout">
          <p>Payments are not open in your country yet. Leave your email and we will tell you when they are.</p>
          {joined ? <p role="status">Thanks, we will write when it opens.</p> : (
            <form className="inline-form" onSubmit={async (e) => { e.preventDefault(); await api('POST', '/api/upgrade/waitlist', { email, country: cat.country }); setJoined(true); }}>
              <label className="field">Email<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label><button className="btn primary">Tell me</button>
            </form>
          )}
        </div>
      ) : (
        <>
          <label className="field">For which topic? (for more notifications or notes)
            <select value={topicId} onChange={(e) => { setTopicId(e.target.value); void load(e.target.value); }}><option value="">Choose a topic</option>{cat.topics.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</select>
          </label>
          <div className="cards">
            {cat.products.map((p) => (
              <div key={p.id} className="card product">
                <strong>{p.title}</strong><span>{p.text}</span>
                <span className="price">{p.amountMinor !== null ? money(p.amountMinor, c) : '—'} <span className="muted small">for {term(p.months)}</span></span>
                {p.unavailable ? <span className="muted small">{p.unavailable}</span>
                  : <button className="btn primary" disabled={!!busy || (p.needsTopic && !topicId)} onClick={() => buy(p)}>{busy === p.id ? 'Opening…' : p.needsTopic && !topicId ? 'Choose a topic first' : 'Buy'}</button>}
              </div>
            ))}
          </div>
          <p className="muted small">How long it lasts depends on how early you are: the first 10 buyers of each get a year, the next 10 six months, the next 50 three months, then one month. {cat.provider === 'razorpay' ? (c === 'INR' ? 'Pay by UPI, card, netbanking or wallet (Razorpay).' : 'Pay by card in US dollars (Razorpay).') : cat.provider === 'stripe' ? 'Pay by card (Stripe), in US dollars.' : 'Test payments (no real money).'} See <Link to="/pricing">pricing</Link> and <Link to="/refunds">refunds</Link>.</p>
        </>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}

/** Back from checkout (Stripe redirect, Razorpay handler): the order is confirmed by the provider, so wait for it. */
export function UpgradeDone() {
  const [params] = useSearchParams();
  const id = params.get('order');
  const [o, setO] = useState<{ status: string; termMonths: number | null } | null>(null);
  useEffect(() => {
    if (!id) return;
    let n = 0; let stop = false;
    const poll = async () => { const r = await api<{ status: string; termMonths: number | null }>('GET', `/api/upgrade/orders/${id}`).catch(() => null); if (stop) return; setO(r); if (r?.status === 'created' && n++ < 20) setTimeout(poll, 1500); };
    void poll(); return () => { stop = true; };
  }, [id]);
  if (params.get('cancelled')) return <section><h1>Payment cancelled</h1><p>Nothing was charged. <Link to="/upgrade">Back to upgrade</Link></p></section>;
  if (!o) return <p className="muted" aria-busy="true">Checking your payment…</p>;
  if (o.status === 'paid') return <section><h1>Thank you</h1><p>It is unlocked{o.termMonths ? ` for ${term(o.termMonths)}` : ''}. <Link to="/manage">Go to my notes</Link></p></section>;
  if (o.status === 'failed') return <section><h1>The payment did not go through</h1><p>Nothing was unlocked. <Link to="/upgrade">Try again</Link></p></section>;
  return <section><h1>Waiting for the payment</h1><p>This can take a minute. You can leave this page; it unlocks as soon as the payment is confirmed.</p></section>;
}

/** Local development only: stands in for the provider's checkout. */
export function MockCheckout() {
  const { id } = useParams();
  const navigate = useNavigate();
  const pay = async (result: 'paid' | 'failed') => { await api('POST', `/api/payments/mock/${id}`, { result }); navigate(`/upgrade/done?order=${id}`); };
  return (
    <section><h1>Test checkout</h1><p className="callout warn">No real payment. This page exists only in local and test builds.</p>
      <div className="actions left"><button className="btn primary" onClick={() => pay('paid')}>Pay (test)</button><button className="btn secondary" onClick={() => pay('failed')}>Fail</button></div></section>
  );
}
