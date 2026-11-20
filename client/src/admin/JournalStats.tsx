import { useEffect, useState } from 'react';
import { admin } from './api';

interface S { total: number; last30Days: number; writers30d: number; withQuote30d: number; withMood30d: number; perDay: Record<string, number>; reminders: { own: number; tiedToQuotes: number } }
/** Counts and dates only. Entry text is encrypted per person and cannot be read or exported from the admin. */
export function JournalStats() {
  const [s, setS] = useState<S | null>(null);
  useEffect(() => { admin<S>('GET', '/journal-stats').then(setS); }, []);
  if (!s) return <p className="muted" aria-busy="true">Loading…</p>;
  const days = Object.entries(s.perDay).sort(([a], [b]) => a.localeCompare(b));
  const max = Math.max(1, ...days.map(([, n]) => n));
  return (
    <>
      <h1>Journal</h1>
      <p className="muted">Counts and dates only. What people write is encrypted for each person and is never shown here.</p>
      <div className="tiles">{([['Entries, all time', s.total], ['Entries, last 30 days', s.last30Days], ['People writing, last 30 days', s.writers30d], ['Written about a note', s.withQuote30d], ['With a mood', s.withMood30d], ['Reminders at own times', s.reminders.own], ['Reminders on notes', s.reminders.tiedToQuotes]] as const).map(([k, v]) => <div key={k} className="tile"><span className="muted small">{k}</span><strong>{v}</strong></div>)}</div>
      <h2>Entries per day (last 30 days)</h2>
      <table className="table" aria-label="Entries per day"><tbody>{days.map(([d, n]) => <tr key={d}><td className="small">{d}</td><td style={{ width: '70%' }}><span className="bar" style={{ width: `${(n / max) * 100}%` }} /></td><td>{n}</td></tr>)}</tbody></table>
      {!days.length && <p className="muted">No entries in the last 30 days.</p>}
    </>
  );
}
