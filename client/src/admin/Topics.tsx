import { useEffect, useMemo, useState } from 'react';
import { Link, Route, Routes, useParams } from 'react-router-dom';
import { admin } from './api';
import { ImportZip } from './ImportZip';

interface Warning { id: string; why: string; match: string }
interface T { _id: string; slug: string; title: string; description: string; visibility: 'public' | 'private'; repeat: boolean; sensitive: boolean; itemCount: number; retiredAt?: string | null; own: { userId: string; status: string; visibility: string } | null; system: boolean }
interface L { id: string; number: number; body: string; attribution: string | null; status?: 'active' | 'retired'; warnings: Warning[] }

/** Same words once case, accents and punctuation are ignored. */
const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
const words = (s: string) => new Set(norm(s).split(' ').filter(Boolean));
const overlap = (a: Set<string>, b: Set<string>) => { let n = 0; for (const w of a) if (b.has(w)) n++; return n / Math.max(1, a.size + b.size - n); };
/**
 * Notes still sending that repeat, or nearly repeat, another note: for each, the numbers of the notes it matches.
 * Both sides of a pair are listed, so the editor chooses which copy to remove.
 */
export function likelyDuplicates(lines: L[], near = 0.8): Map<string, number[]> {
  const live = lines.filter((l) => l.status !== 'retired').map((l) => ({ l, key: norm(l.body), w: words(l.body) }));
  const out = new Map<string, number[]>();
  const add = (id: string, n: number) => out.set(id, [...(out.get(id) ?? []), n]);
  for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
    const a = live[i], b = live[j];
    if (a.key === b.key || overlap(a.w, b.w) >= near) { add(a.l.id, b.l.number); add(b.l.id, a.l.number); }
  }
  return out;
}

export function Topics() {
  return <Routes><Route path="/" element={<List />} /><Route path=":id" element={<Detail />} /></Routes>;
}

const Flags = ({ w }: { w: Warning[] }) => (w.length ? <span className="draft-flag" title={w.map((x) => x.why).join(' ')}>May look like spam: {w.map((x) => x.match).join(', ')}</span> : null);

function List() {
  const [topics, setTopics] = useState<T[]>([]);
  const [review, setReview] = useState<{ _id: string; title: string; email: string; platformTopicId: string }[]>([]);
  const [form, setForm] = useState({ slug: '', title: '', description: '', sensitive: false });
  const [error, setError] = useState<string | null>(null);
  const load = async () => { setTopics((await admin<{ topics: T[] }>('GET', '/topics')).topics); setReview((await admin<{ topics: any[] }>('GET', '/own-topics?status=review')).topics); };
  useEffect(() => { void load(); }, []);
  const act = async (fn: () => Promise<unknown>) => { setError(null); try { await fn(); await load(); } catch (e: any) { setError(e.message); } };
  const curated = topics.filter((t) => !t.own && !t.system);
  return (
    <>
      <h1>Topics</h1>
      <p className="muted">Topics and their notes live on the notification platform; this page manages them through its content API. Notes are only added at the end or edited, never deleted or reordered, so every person’s place in a course stays right. A new topic starts private; make it public when its notes are ready.</p>
      <table className="table"><thead><tr><th>Topic</th><th>Notes</th><th>Shown to people</th><th /></tr></thead><tbody>
        {curated.map((t) => (
          <tr key={t._id}><td><Link to={t._id}>{t.title}</Link> <span className="small muted">{t.slug}{t.sensitive ? ' · sensitive' : ''}</span></td><td>{t.itemCount}</td>
            <td>{t.retiredAt ? 'retired' : t.visibility === 'public' ? 'yes' : 'not yet'}</td>
            <td>{t.visibility === 'private' ? <button className="link" onClick={() => act(() => admin('PATCH', `/topics/${t._id}`, { visibility: 'public' }))}>Make public</button>
              : <button className="link" onClick={() => act(() => admin('PATCH', `/topics/${t._id}`, { retired: !t.retiredAt }))}>{t.retiredAt ? 'Un-retire' : 'Retire'}</button>}</td></tr>
        ))}
      </tbody></table>
      <form className="inline-form" onSubmit={(e) => { e.preventDefault(); void act(async () => { await admin('POST', '/topics', { ...form, visibility: 'private' }); setForm({ slug: '', title: '', description: '', sensitive: false }); }); }}>
        <strong>New topic</strong>
        <label className="field">Title<input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value, slug: form.slug || '' })} /></label>
        <label className="field">Short name (a-z, 0-9, -)<input required pattern="[a-z0-9-]{2,40}" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} /></label>
        <label className="field">Description<input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
        <label className="check"><input type="checkbox" checked={form.sensitive} onChange={(e) => setForm({ ...form, sensitive: e.target.checked })} /><span>Sensitive (shows care text when people choose it)</span></label>
        <button className="btn primary">Create</button>
      </form>
      <ImportZip onDone={load} />
      <h2>People’s own topics waiting for review (VAVP3, public)</h2>
      {review.length ? <ul>{review.map((r) => <li key={r._id}><Link to={r.platformTopicId}>{r.title}</Link> by {r.email} — <button className="link" onClick={() => act(() => admin('POST', `/own-topics/${r._id}/approve`))}>Approve and publish</button> · <button className="link danger" onClick={() => act(() => admin('POST', `/own-topics/${r._id}/reject`))}>Reject</button></li>)}</ul> : <p className="muted">None.</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </>
  );
}

function Detail() {
  const { id } = useParams();
  const [lines, setLines] = useState<L[]>([]);
  const [text, setText] = useState('');
  const [check, setCheck] = useState<Warning[] | null>(null);
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dupesOnly, setDupesOnly] = useState(false);
  const load = () => admin<{ lines: L[] }>('GET', `/topics/${id}/lines`).then((r) => setLines(r.lines));
  useEffect(() => { void load(); }, [id]);
  const act = async (fn: () => Promise<unknown>) => { setError(null); try { await fn(); await load(); } catch (e: any) { setError(e.message); } };
  const flagged = lines.filter((l) => l.warnings.length).length;
  const dupes = useMemo(() => likelyDuplicates(lines), [lines]);
  const removed = lines.filter((l) => l.status === 'retired').length;
  const remove = (l: L) => { if (window.confirm(`Remove note ${l.number}? It stops being sent. Nobody's place in the course moves, and you can restore it later.`)) void act(() => admin('POST', `/topics/${id}/lines/${l.id}/remove`)); };
  const shown = dupesOnly ? lines.filter((l) => dupes.has(l.id)) : lines;
  return (
    <>
      <p className="small"><Link to="/admin/topics">← Topics</Link></p>
      <h1>Notes</h1>
      <p className="muted">{lines.length - removed} notes{removed ? ` (${removed} removed)` : ''}{flagged ? ` · ${flagged} may look like spam to Chrome (hover the flag for why)` : ''}.</p>
      <label className="check"><input type="checkbox" checked={dupesOnly} onChange={(e) => setDupesOnly(e.target.checked)} /><span>Show likely duplicates only ({dupes.size})</span></label>
      <ol className="own-lines">{shown.map((l) => (
        <li key={l.id} value={l.number} className={l.status === 'retired' ? 'muted' : undefined}>{l.status === 'retired'
          ? <><s>{l.body}</s> <span className="small">removed</span> <button className="link small" onClick={() => act(() => admin('POST', `/topics/${id}/lines/${l.id}/restore`))}>Restore</button></>
          : editing?.id === l.id
          ? <span className="inline-form"><input aria-label={`Note ${l.number}`} value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} /><button className="btn primary" onClick={() => act(async () => { await admin('PATCH', `/topics/${id}/lines/${l.id}`, { body: editing.body }); setEditing(null); })}>Save</button><button className="link" onClick={() => setEditing(null)}>Cancel</button></span>
          : <>{l.body} <Flags w={l.warnings} />{dupes.has(l.id) && <span className="draft-flag">like note {dupes.get(l.id)!.join(', ')}</span>} <button className="link small" onClick={() => setEditing({ id: l.id, body: l.body })}>Edit</button> · <button className="link small danger" onClick={() => remove(l)}>Remove</button></>}</li>
      ))}</ol>
      <label className="field">Add notes at the end, one per line<textarea rows={5} value={text} onChange={(e) => { setText(e.target.value); setCheck(null); }} /></label>
      <div className="actions left">
        <button className="btn secondary" onClick={async () => setCheck((await admin<{ warnings: Warning[] }>('POST', '/content-check', { text })).warnings)}>Check wording</button>
        <button className="btn primary" disabled={!text.trim()} onClick={() => act(async () => { await admin('POST', `/topics/${id}/lines`, { lines: text.split('\n').map((b) => b.trim()).filter(Boolean).map((body) => ({ body })) }); setText(''); })}>Add</button>
      </div>
      {check && (check.length ? <div className="callout warn"><strong>This may look like spam to Chrome on Android:</strong><ul>{check.map((w) => <li key={w.id}>“{w.match}” — {w.why}</li>)}</ul></div> : <p role="status">No spam-like wording found.</p>)}
      {error && <p className="error" role="alert">{error}</p>}
    </>
  );
}
