import { useEffect, useState } from 'react';
import { admin, rupees, dollars } from './api';

interface O { users: number; newUsers30d: number; levels: Record<string, number>; referralVisits: number; signupsReferred: number; proofsPending: number; orders: number; revenueMinor: Record<string, number>; journalEntries: number }
export function Overview() {
  const [o, setO] = useState<O | null>(null);
  useEffect(() => { admin<O>('GET', '/overview').then(setO); }, []);
  if (!o) return <p className="muted" aria-busy="true">Loading…</p>;
  const tiles: [string, string | number][] = [
    ['People', o.users], ['Joined in the last 30 days', o.newUsers30d], ['Referral visits', o.referralVisits], ['Sign-ups through referrals', o.signupsReferred],
    ['Social posts waiting for review', o.proofsPending], ['Paid orders', o.orders],
    ['Revenue', [o.revenueMinor.INR ? rupees(o.revenueMinor.INR) : '', o.revenueMinor.USD ? dollars(o.revenueMinor.USD) : ''].filter(Boolean).join(' + ') || '—'],
    ['Journal entries (count only)', o.journalEntries],
  ];
  return (
    <>
      <h1>Overview</h1>
      <div className="tiles">{tiles.map(([k, v]) => <div key={k} className="tile"><span className="muted small">{k}</span><strong>{v}</strong></div>)}</div>
      <h2>People by level reached</h2>
      {Object.keys(o.levels).length ? <ul>{Object.entries(o.levels).map(([l, n]) => <li key={l}>Level {l}: {n}</li>)}</ul> : <p className="muted">No one has reached a level yet.</p>}
    </>
  );
}
