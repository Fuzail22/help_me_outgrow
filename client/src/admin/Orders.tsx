import { useEffect, useState } from 'react';
import { admin, dollars, rupees, when } from './api';

interface O { _id: string; email: string; product: string; topicId: string | null; amountMinor: number; currency: string; provider: string; status: string; rank: number | null; termMonths: number | null; createdAt: string; paidAt: string | null }
export function Orders() {
  const [d, setD] = useState<{ orders: O[]; buyers: Record<string, number>; waitlist: number } | null>(null);
  useEffect(() => { admin<typeof d>('GET', '/orders').then(setD); }, []);
  if (!d) return <p className="muted" aria-busy="true">Loading…</p>;
  return (
    <>
      <h1>Orders</h1>
      <p className="muted">Buyers so far by product (this number decides how long a new purchase lasts): {Object.entries(d.buyers).map(([k, v]) => `${k} ${v}`).join(' · ') || 'none yet'}. Waitlist outside India: {d.waitlist}.</p>
      <table className="table"><thead><tr><th>When</th><th>Person</th><th>Product</th><th>Amount</th><th>Provider</th><th>Status</th><th>Buyer #</th><th>Lasts</th></tr></thead><tbody>
        {d.orders.map((o) => <tr key={o._id}><td className="small">{when(o.paidAt ?? o.createdAt)}</td><td>{o.email}</td><td>{o.product}</td><td>{o.currency === 'INR' ? rupees(o.amountMinor) : dollars(o.amountMinor)}</td><td>{o.provider}</td><td>{o.status}</td><td>{o.rank ?? '—'}</td><td>{o.termMonths ? `${o.termMonths} mo` : '—'}</td></tr>)}
      </tbody></table>
    </>
  );
}
