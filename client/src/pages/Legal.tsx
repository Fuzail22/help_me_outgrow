import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/ns';

/*
 * Pages payment providers ask to see before they activate an account (pricing, refunds, terms, contact).
 * DRAFTS: written for this project, not reviewed by a lawyer. The owner should review them before going live.
 */
interface Ladder { start: number; step: number; band: number; maxBuyers: number }
interface P { vavp1Units: number[]; vavp1Bundle3: number; vavp2: { items: number; price: number }[]; vavp3: { private: Ladder; public: Ladder }; terms: { upTo: number | null; months: number }[]; international: boolean; usd: { vavp1Unit: number; vavp1Bundle3: number; vavp2: number[]; vavp3Private: number; vavp3Public: number }; supportEmail: string }
const r = (p: number) => `₹${(p / 100).toLocaleString('en-IN')}`;
const d = (c: number) => `$${(c / 100).toFixed(2)}`;
const SUPPORT = 'support@htsta.com';

export function Pricing() {
  const [p, setP] = useState<P | null>(null);
  useEffect(() => { api<P>('GET', '/api/public/pricing').then(setP).catch(() => undefined); }, []);
  return (
    <section className="prose">
      <h1>Pricing</h1>
      <p>help me outgrow is free: up to three notes a day on a topic, for up to three months. You can earn more by helping the app grow (<Link to="/growth">see how</Link>), or pay for it. All prices include taxes where applicable.</p>
      {!p ? <p className="muted">Loading…</p> : (
        <>
          <h2>More notifications a day, on one topic</h2>
          <ul>{p.vavp1Units.map((x, i) => <li key={i}>{['First', 'Second', 'Third', 'Fourth', 'Fifth'][i] ?? `Number ${i + 1}`} extra notification: {r(x)}</li>)}<li>Three together: {r(p.vavp1Bundle3)}</li></ul>
          <h2>More notes on one topic</h2>
          <ul>{p.vavp2.map((x, i) => <li key={i}>{x.items} more notes: {r(x.price)}</li>)}</ul>
          <h2>Your own topic (up to 150 notes)</h2>
          <ul>
            <li>Just for you: {r(p.vavp3.private.start)} for the first {p.vavp3.private.band} buyers, then {r(p.vavp3.private.step)} more for every {p.vavp3.private.band} buyers (the price stops rising after {p.vavp3.private.maxBuyers} buyers).</li>
            <li>Open to others, after review: {r(p.vavp3.public.start)}, rising the same way.</li>
          </ul>
          <h2>How long a purchase lasts</h2>
          <p>Early buyers of each product get longer:</p>
          <ul>{p.terms.map((t, i) => <li key={i}>{t.upTo === null ? 'Everyone after' : `Buyers up to number ${t.upTo}`}: {t.months} months</li>)}</ul>
          <p>A purchase is a one-time payment for that period. Nothing renews automatically; we remind you three days before it ends.</p>
          {p.international && <><h2>Outside India</h2><p>Prices in US dollars: one more notification a day {d(p.usd.vavp1Unit)} (three for {d(p.usd.vavp1Bundle3)}), more notes from {d(p.usd.vavp2[0] ?? 100)}, your own topic {d(p.usd.vavp3Private)} (private) or {d(p.usd.vavp3Public)} (public).</p></>}
        </>
      )}
      <p>Payments are handled by Razorpay: UPI, cards, netbanking and wallets in India, and international cards in US dollars elsewhere. We never see your card or UPI details. See <Link to="/refunds">refunds</Link> and <Link to="/terms">terms</Link>.</p>
    </section>
  );
}

export function Refunds() {
  return (
    <section className="prose">
      <h1>Cancellations and refunds</h1>
      <p className="draft-flag">Draft for review before launch.</p>
      <ul>
        <li>If a payment went through but nothing was unlocked, write to <a href={`mailto:${SUPPORT}`}>{SUPPORT}</a> with the date and amount. We will unlock it or refund it in full.</li>
        <li>You can ask for a full refund within 7 days of a purchase, for any reason, by writing to {SUPPORT} from the email you sign in with.</li>
        <li>After 7 days, purchases are not refundable, but you can stop using them at any time.</li>
        <li>Refunds go back to the original payment method. Razorpay usually takes 5 to 7 working days.</li>
        <li>If we close the service, unused time on a purchase is refunded in proportion.</li>
      </ul>
    </section>
  );
}

export function Terms() {
  return (
    <section className="prose">
      <h1>Terms of use</h1>
      <p className="draft-flag">Draft for review before launch.</p>
      <ul>
        <li>help me outgrow sends short notes of encouragement at times you choose. It is not medical advice, treatment or a crisis service. If you are in danger, contact local emergency services or a helpline.</li>
        <li>You need a Google or Zoho account to sign in. Keep it secure; you are responsible for what happens under your account.</li>
        <li>Your own topic and anything you write must not be unlawful, hateful, or harmful to others. We may refuse to publish, or remove, a public topic that is.</li>
        <li>Referral visits and social posts must be genuine. We may withhold levels earned by fake visits or accounts.</li>
        <li>Paid privileges last for the period shown when you buy; see <Link to="/pricing">pricing</Link> and <Link to="/refunds">refunds</Link>.</li>
        <li>Your journal is private to you. We store it encrypted and cannot show it to anyone else; you can export or delete it at any time.</li>
        <li>We may change these terms; we will tell you in the app before changes that affect you take effect.</li>
      </ul>
      <p>See also the <Link to="/privacy">privacy notice</Link>.</p>
    </section>
  );
}

export function Contact() {
  return (
    <section className="prose">
      <h1>Contact</h1>
      <p>Email <a href={`mailto:${SUPPORT}`}>{SUPPORT}</a>. We usually answer within two working days.</p>
      <p>For a payment, include the date and amount. For your own topic, include its title. To send a screenshot of a post about us, use the email address you sign in with.</p>
    </section>
  );
}
