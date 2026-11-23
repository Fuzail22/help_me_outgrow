import { useEffect, useState } from 'react';
import { Link, Route, Routes, useParams } from 'react-router-dom';
import { admin, when } from './api';

export interface GroupRow { _id: string; name: string; description: string; memberCount: number; createdAt: string }
interface Member { id: string; email: string; name: string; addedAt: string; addedBy: string }
export interface Person { id: string; email: string; name: string }

/** G11: groups of people that topics can be shown to (Topics → a topic → Who sees it). */
export function Groups() {
  return <Routes><Route path="/" element={<List />} /><Route path=":id" element={<Detail />} /></Routes>;
}

function List() {
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [form, setForm] = useState({ name: '', description: '' });
  const [error, setError] = useState<string | null>(null);
  const load = () => admin<{ groups: GroupRow[] }>('GET', '/groups').then((r) => setGroups(r.groups));
  useEffect(() => { void load(); }, []);
  return (
    <>
      <h1>Groups</h1>
      <p className="muted">A group is a set of people. On a topic’s page you can show it to everyone, or only to chosen groups and people. Someone who leaves a group keeps any course already running; they just cannot start a new one on a topic they no longer see.</p>
      <table className="table"><thead><tr><th>Group</th><th>People</th><th>Created</th></tr></thead><tbody>
        {groups.map((g) => <tr key={g._id}><td><Link to={g._id}>{g.name}</Link>{g.description && <span className="small muted"> {g.description}</span>}</td><td>{g.memberCount}</td><td className="small">{when(g.createdAt)}</td></tr>)}
      </tbody></table>
      {!groups.length && <p className="muted">No groups yet.</p>}
      <form className="inline-form" onSubmit={(e) => { e.preventDefault(); setError(null); admin('POST', '/groups', form).then(() => { setForm({ name: '', description: '' }); return load(); }).catch((x) => setError(x.message)); }}>
        <strong>New group</strong>
        <label className="field">Name<input required maxLength={60} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
        <label className="field">Description<input maxLength={300} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
        <button className="btn primary">Create</button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
    </>
  );
}

/** Find people by email, id or referral code (the same search as the People page) and pick one. */
export function PersonPicker({ onPick, exclude = [], label = 'Add a person' }: { onPick: (p: Person) => void; exclude?: string[]; label?: string }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Person[] | null>(null);
  return (
    <div>
      <form className="inline-form" onSubmit={(e) => { e.preventDefault(); void admin<{ users: Person[] }>('GET', `/users?q=${encodeURIComponent(q)}`).then((r) => setRows(r.users)); }}>
        <label className="field">{label} (email, id or referral code)<input value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <button className="btn secondary">Find</button>
      </form>
      {rows && (rows.filter((r) => !exclude.includes(r.id)).length
        ? <ul>{rows.filter((r) => !exclude.includes(r.id)).map((r) => <li key={r.id}>{r.name} <span className="small muted">{r.email}</span> <button className="link" onClick={() => { onPick(r); setRows(null); setQ(''); }}>Add</button></li>)}</ul>
        : <p className="muted small">Nobody else found.</p>)}
    </div>
  );
}

function Detail() {
  const { id } = useParams();
  const [d, setD] = useState<{ group: GroupRow; members: Member[]; topics: { id: string; title: string }[] } | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = () => admin<NonNullable<typeof d>>('GET', `/groups/${id}`).then(setD);
  useEffect(() => { void load(); }, [id]);
  const act = async (fn: () => Promise<unknown>) => { setError(null); try { await fn(); await load(); } catch (e: any) { setError(e.message); } };
  if (gone) return <><p className="small"><Link to="/admin/groups">← Groups</Link></p><p role="status">Group deleted.</p></>;
  if (!d) return <p className="muted" aria-busy="true">Loading…</p>;
  return (
    <>
      <p className="small"><Link to="/admin/groups">← Groups</Link></p>
      {name === null
        ? <h1>{d.group.name} <button className="link small" onClick={() => setName(d.group.name)}>Rename</button></h1>
        : <form className="inline-form" onSubmit={(e) => { e.preventDefault(); void act(async () => { await admin('PATCH', `/groups/${id}`, { name }); setName(null); }); }}>
            <label className="field">Name<input required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} /></label>
            <button className="btn primary">Save</button><button type="button" className="link" onClick={() => setName(null)}>Cancel</button>
          </form>}
      {d.group.description && <p className="muted">{d.group.description}</p>}
      <p>Sees: {d.topics.length ? d.topics.map((t, i) => <span key={t.id}>{i ? ', ' : ''}<Link to={`/admin/topics/${t.id}`}>{t.title}</Link></span>) : <span className="muted">no restricted topics yet</span>}</p>
      <h2>People ({d.members.length})</h2>
      {d.members.length ? (
        <table className="table"><thead><tr><th>Name</th><th>Email</th><th>Added</th><th /></tr></thead><tbody>
          {d.members.map((m) => <tr key={m.id}><td><Link to={`/admin/people/${m.id}`}>{m.name}</Link></td><td>{m.email}</td><td className="small">{when(m.addedAt)} by {m.addedBy}</td>
            <td><button className="link danger" onClick={() => act(() => admin('DELETE', `/groups/${id}/members/${m.id}`))}>Remove</button></td></tr>)}
        </tbody></table>
      ) : <p className="muted">Nobody in this group yet.</p>}
      <PersonPicker exclude={d.members.map((m) => m.id)} onPick={(p) => void act(() => admin('POST', `/groups/${id}/members`, { userIds: [p.id] }))} />
      <p><button className="btn secondary danger" onClick={() => { if (confirm(`Delete “${d.group.name}”? Its people stop seeing topics shown only to this group (running courses go on).`)) void admin('DELETE', `/groups/${id}`).then(() => setGone(true)).catch((e) => setError(e.message)); }}>Delete group</button></p>
      {error && <p className="error" role="alert">{error}</p>}
    </>
  );
}
