import { useEffect, useState } from 'react';
import { admin, when, type Role } from './api';

interface A { _id: string; email: string; role: Role; invitedBy: string | null; lastSignInAt: string | null }
const ROLE_HELP: Record<Role, string> = {
  owner: 'everything, including prices, manual grants, admins and the audit log.',
  editor: 'limits, levels and VAVP settings, topics and lines.',
  support: 'finds people and reviews social-post proofs.',
  viewer: 'overview, stats and settings, read only.',
};
export function Admins() {
  const [list, setList] = useState<A[]>([]);
  const [email, setEmail] = useState(''); const [role, setRole] = useState<Role>('support');
  const [error, setError] = useState<string | null>(null);
  const load = () => admin<{ admins: A[] }>('GET', '/admins').then((r) => setList(r.admins));
  useEffect(() => { void load(); }, []);
  const act = async (fn: () => Promise<unknown>) => { setError(null); try { await fn(); await load(); } catch (e: any) { setError(e.message); } };
  return (
    <>
      <h1>Admins</h1>
      <p className="muted">People sign in with Google or Zoho using the invited address.</p>
      <ul className="small">{Object.entries(ROLE_HELP).map(([r, t]) => <li key={r}><strong>{r}</strong>: {t}</li>)}</ul>
      <table className="table"><thead><tr><th>Email</th><th>Role</th><th>Last seen</th><th /></tr></thead><tbody>
        {list.map((a) => (
          <tr key={a._id}><td>{a.email}</td>
            <td><select aria-label={`Role for ${a.email}`} value={a.role} onChange={(e) => act(() => admin('PATCH', `/admins/${a._id}`, { role: e.target.value }))}>{Object.keys(ROLE_HELP).map((r) => <option key={r}>{r}</option>)}</select></td>
            <td className="small muted">{when(a.lastSignInAt)}</td>
            <td><button className="link" onClick={() => act(() => admin('DELETE', `/admins/${a._id}`))}>Remove</button></td></tr>
        ))}
      </tbody></table>
      <form className="inline-form" onSubmit={(e) => { e.preventDefault(); void act(async () => { await admin('POST', '/admins', { email, role }); setEmail(''); }); }}>
        <label className="field">Invite by email<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label className="field">Role<select value={role} onChange={(e) => setRole(e.target.value as Role)}>{Object.keys(ROLE_HELP).map((r) => <option key={r}>{r}</option>)}</select></label>
        <button className="btn primary">Invite</button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
    </>
  );
}

interface E { _id: string; actor: string; action: string; target: string | null; before: unknown; after: unknown; ts: string }
export function Audit() {
  const [entries, setEntries] = useState<E[]>([]);
  const [more, setMore] = useState(true);
  const load = async (before?: string) => { const r = await admin<{ entries: E[] }>('GET', `/audit${before ? `?before=${before}` : ''}`); setEntries((x) => (before ? [...x, ...r.entries] : r.entries)); setMore(r.entries.length === 50); };
  useEffect(() => { void load(); }, []);
  return (
    <>
      <h1>Audit log</h1>
      <p className="muted">Every admin change, newest first, with the values before and after.</p>
      <ul className="audit">{entries.map((e) => (
        <li key={e._id}><div className="row"><strong>{e.action}</strong><span className="small muted">{when(e.ts)}</span></div>
          <div className="small">{e.actor}{e.target ? ` → ${e.target}` : ''}</div>
          <details><summary className="small">Before and after</summary><pre>{JSON.stringify({ before: e.before, after: e.after }, null, 2)}</pre></details></li>
      ))}</ul>
      {more && entries.length > 0 && <button className="btn secondary" onClick={() => load(entries.at(-1)!._id)}>Older</button>}
    </>
  );
}
