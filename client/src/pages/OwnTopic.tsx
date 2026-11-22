import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/ns';
import { useSession } from '../lib/session';
import { SignIn } from '../components/SignIn';

interface Warning { id: string; why: string; match: string }
interface Line { id: string; number: number; body: string; warnings: Warning[] }
interface Own { _id: string; title: string; visibility: 'private' | 'public'; status: 'live' | 'review' | 'rejected'; lineCap: number; active: boolean; lines: number; platformTopicId: string }
interface List { lineCap: number; supportEmail: string; available: { entitlementId: string; visibility: string; expiresAt: string | null }[]; topics: Own[] }

/** VAVP3: write a topic of your own. Private (only you get it) or public (others may follow it, after review). */
export function OwnTopic() {
  const { user, setUser } = useSession();
  const [list, setList] = useState<List | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState({ title: '', description: '', visibility: 'private' as 'private' | 'public' });
  const [error, setError] = useState<string | null>(null);
  const load = () => api<List>('GET', '/api/own-topics').then((l) => { setList(l); if (!open && l.topics[0]) setOpen(l.topics[0]._id); });
  useEffect(() => { if (user) void load(); }, [user]);
  if (user === undefined) return <p className="muted" aria-busy="true">Loading…</p>;
  if (!user) return <section><h1>Your own topic</h1><SignIn onSignedIn={setUser} /></section>;
  if (!list) return <p className="muted" aria-busy="true">Loading…</p>;
  const canCreate = list.available.length > 0;
  const allowPublic = list.available.some((a) => a.visibility !== 'private');
  const allowPrivate = list.available.some((a) => a.visibility !== 'public');
  return (
    <section>
      <h1>Your own topic</h1>
      <p className="lede">Write the notes you want to receive, up to {list.lineCap}. You choose the times like any other topic.</p>
      {!canCreate && !list.topics.length && <div className="callout"><p>Unlock it at a level on <Link to="/growth">Grow with us</Link>, or get it on the <Link to="/upgrade">upgrade page</Link>.</p></div>}
      {canCreate && (
        <form className="panel" onSubmit={async (e) => { e.preventDefault(); setError(null); try { await api('POST', '/api/own-topics', form); setForm({ ...form, title: '', description: '' }); await load(); } catch (err: any) { setError(err.message); } }}>
          <h2>Start a topic</h2>
          <label className="field">Title<input required minLength={2} maxLength={60} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
          <label className="field">What it is for (optional)<input maxLength={300} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
          <div className="chips" role="radiogroup" aria-label="Who can follow it">
            {allowPrivate && <button type="button" role="radio" aria-checked={form.visibility === 'private'} className={'chip' + (form.visibility === 'private' ? ' on' : '')} onClick={() => setForm({ ...form, visibility: 'private' })}>Only me</button>}
            {allowPublic && <button type="button" role="radio" aria-checked={form.visibility === 'public'} className={'chip' + (form.visibility === 'public' ? ' on' : '')} onClick={() => setForm({ ...form, visibility: 'public' })}>Anyone (after review)</button>}
          </div>
          <button className="btn primary">Create</button>
        </form>
      )}
      {list.topics.map((t) => (
        <article key={t._id} className="enrolment">
          <div className="row"><strong>{t.title}</strong><span className="badge">{t.status === 'review' ? 'Waiting for review' : t.status === 'rejected' ? 'Not approved' : t.visibility === 'public' ? 'Public' : 'Only you'}</span></div>
          <p className="muted small">{t.lines} of {t.lineCap} notes{!t.active ? ' · privilege ended' : ''}</p>
          {open === t._id ? <Lines topic={t} cap={t.lineCap} supportEmail={list.supportEmail} onChange={load} /> : <button className="link" onClick={() => setOpen(t._id)}>Open</button>}
        </article>
      ))}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}

function Lines({ topic, cap, supportEmail, onChange }: { topic: Own; cap: number; supportEmail: string; onChange: () => void }) {
  const [lines, setLines] = useState<Line[]>([]);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const load = () => api<{ lines: Line[] }>('GET', `/api/own-topics/${topic._id}/lines`).then((r) => setLines(r.lines)).catch((e) => setError(e.message));
  useEffect(() => { void load(); }, [topic._id]);
  const add = async () => {
    setError(null);
    const bodies = text.split('\n').map((x) => x.trim()).filter(Boolean);
    try { await api('POST', `/api/own-topics/${topic._id}/lines`, { lines: bodies.map((body) => ({ body })) }); setText(''); await load(); onChange(); } catch (e: any) { setError(e.message); }
  };
  if (!topic.active) return <p className="muted">This topic’s privilege has ended. Renew it on the <Link to="/upgrade">upgrade page</Link>.</p>;
  return (
    <div className="panel">
      <ol className="own-lines">{lines.map((l) => (
        <li key={l.id}>{l.body}{l.warnings.length > 0 && <span className="draft-flag" title={l.warnings.map((w) => w.why).join(' ')}> May look like spam: {l.warnings.map((w) => w.match).join(', ')}</span>}</li>
      ))}</ol>
      <label className="field">Add notes, one per line (each up to 300 characters)<textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} /></label>
      <p className="muted small">{lines.length} of {cap}. Notes are sent in this order. Need more than {cap}? Write to <a href={`mailto:${supportEmail}?subject=${encodeURIComponent(`More lines for my topic ${topic.title}`)}`}>{supportEmail}</a>.</p>
      <button className="btn primary" disabled={!text.trim()} onClick={add}>Add</button>
      {lines.length > 0 && <p><Link to="/start">Choose times for it</Link></p>}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
