import { useEffect, useState } from 'react';
import { Link, Route, Routes, useParams } from 'react-router-dom';
import { admin, can, rupees, dollars, when } from './api';
import type { AdminMe } from './Admin';

interface Row { id: string; email: string; name: string; createdAt: string; referralCode: string; providers: string[] }
export function People({ me }: { me: AdminMe }) {
  return <Routes><Route path="/" element={<Search />} /><Route path=":id" element={<Person me={me} />} /></Routes>;
}

function Search() {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const find = (query: string) => admin<{ users: Row[] }>('GET', `/users?q=${encodeURIComponent(query)}`).then((r) => setRows(r.users));
  useEffect(() => { void find(''); }, []);
  return (
    <>
      <h1>People</h1>
      <form className="inline-form" onSubmit={(e) => { e.preventDefault(); void find(q); }}>
        <label className="field">Email, id or referral code<input value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <button className="btn secondary">Find</button>
      </form>
      <table className="table"><thead><tr><th>Name</th><th>Email</th><th>Joined</th><th>Sign-in</th></tr></thead><tbody>
        {rows.map((u) => <tr key={u.id}><td><Link to={u.id}>{u.name}</Link></td><td>{u.email}</td><td className="small">{when(u.createdAt)}</td><td className="small">{u.providers.join(', ')}</td></tr>)}
      </tbody></table>
    </>
  );
}

interface Ent { _id: string; kind: string; topicId: string | null; amount: number; source: string; sourceRef: string; startsAt: string; expiresAt: string | null; revokedAt: string | null; active: boolean; meta?: { note?: string } }
interface Detail {
  user: { id: string; email: string; name: string; createdAt: string; referralCode: string; referredBy: { userId: string } | null; providers: string[] };
  entitlements: Ent[]; unlocks: { level: number; at: string; pick: { vavp: string; topicId: string | null; amount: number } | null }[];
  orders: { _id: string; product: string; amountMinor: number; currency: string; status: string; termMonths: number | null; paidAt: string | null }[];
  referrals: { visits: number; signups: number }; journalEntries: number;
}
const KIND: Record<string, string> = { slots: 'Extra notifications a day', items: 'Extra quotes', own_topic: 'Own topic' };

function Person({ me }: { me: AdminMe }) {
  const { id } = useParams();
  const [d, setD] = useState<Detail | null>(null);
  const [form, setForm] = useState({ kind: 'slots', topicId: '', amount: 1, months: '', note: '' });
  const [error, setError] = useState<string | null>(null);
  const load = () => admin<Detail>('GET', `/users/${id}`).then(setD);
  useEffect(() => { void load(); }, [id]);
  if (!d) return <p className="muted" aria-busy="true">Loading…</p>;
  const act = async (fn: () => Promise<unknown>) => { setError(null); try { await fn(); await load(); } catch (e: any) { setError(e.message); } };
  return (
    <>
      <p className="small"><Link to="/admin/people">← People</Link></p>
      <h1>{d.user.name}</h1>
      <p className="muted">{d.user.email} · joined {when(d.user.createdAt)} · signs in with {d.user.providers.join(', ')} · referral code <code>{d.user.referralCode}</code></p>
      <p>Referral visits: <strong>{d.referrals.visits}</strong> · sign-ups through their link: <strong>{d.referrals.signups}</strong> · journal entries: <strong>{d.journalEntries}</strong> <span className="muted small">(content is never shown here)</span></p>
      <h2>Levels</h2>
      {d.unlocks.length ? <ul>{d.unlocks.map((u) => <li key={u.level}>Level {u.level} on {when(u.at)} — {u.pick ? `picked ${u.pick.vavp.toUpperCase()} (+${u.pick.amount})` : 'pick not made yet'}</li>)}</ul> : <p className="muted">No level reached yet.</p>}
      <h2>Privileges</h2>
      <table className="table"><thead><tr><th>What</th><th>Topic</th><th>Amount</th><th>Source</th><th>Until</th><th /></tr></thead><tbody>
        {d.entitlements.map((e) => (
          <tr key={e._id} className={e.active ? '' : 'muted'}><td>{KIND[e.kind] ?? e.kind}</td><td className="small">{e.topicId ?? '—'}</td><td>+{e.amount}</td>
            <td className="small">{e.source}{e.meta?.note ? ` — ${e.meta.note}` : ''}</td><td className="small">{e.revokedAt ? 'revoked' : e.expiresAt ? when(e.expiresAt) : 'no end'}</td>
            <td>{can(me, 'owner') && e.active && <button className="link" onClick={() => act(() => admin('DELETE', `/users/${d.user.id}/entitlements/${e._id}`))}>Revoke</button>}</td></tr>
        ))}
      </tbody></table>
      {can(me, 'owner') && (
        <form className="inline-form" onSubmit={(ev) => { ev.preventDefault(); void act(() => admin('POST', `/users/${d.user.id}/entitlements`, { kind: form.kind, topicId: form.topicId || null, amount: Number(form.amount), months: form.months ? Number(form.months) : null, note: form.note })); }}>
          <strong>Grant by hand</strong>
          <label className="field">What<select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}><option value="slots">Extra notifications a day</option><option value="items">Extra quotes</option><option value="own_topic">Own topic (VAVP3; leave topic empty)</option></select></label>
          <label className="field">Topic id<input value={form.topicId} onChange={(e) => setForm({ ...form, topicId: e.target.value })} /></label>
          <label className="field">Amount<input type="number" min={1} value={form.amount} onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })} /></label>
          <label className="field">Months (empty: no end)<input type="number" min={1} value={form.months} onChange={(e) => setForm({ ...form, months: e.target.value })} /></label>
          <label className="field">Why (kept in the audit log)<input required value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
          <button className="btn primary">Grant</button>
        </form>
      )}
      <h2>Orders</h2>
      {d.orders.length ? <ul>{d.orders.map((o) => <li key={o._id}>{o.product}: {o.currency === 'INR' ? rupees(o.amountMinor) : dollars(o.amountMinor)} — {o.status}{o.termMonths ? `, ${o.termMonths} months` : ''} {o.paidAt ? `(${when(o.paidAt)})` : ''}</li>)}</ul> : <p className="muted">No orders.</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </>
  );
}
