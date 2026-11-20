import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, app, ns } from '../lib/ns';
import { useSession } from '../lib/session';
import { SignIn } from '../components/SignIn';
import { SchedulePicker, scheduleValid } from '../components/SchedulePicker';
import { browserTimezone, describeSchedule, formatDate, fromSlots, toSlots } from '../lib/time';
import type { Slot } from '@notification-service/sdk';

interface Entry { id: string; ts: string; text: string; mood: number | null; quote: { body: string; attribution: string | null; topic: string } | null; prompt: string | null }
interface Reminder { mode: 'off' | 'own' | 'tie'; slots: Slot[]; timezone: string | null; tiedTopicId: string | null; endDate: string | null }
const MOODS = [{ v: 1, label: 'Very low' }, { v: 2, label: 'Low' }, { v: 3, label: 'Okay' }, { v: 4, label: 'Good' }, { v: 5, label: 'Very good' }];
const SOFT_PROMPTS = ['How are you, really?', 'What is on your mind?', 'What stayed with you today?'];
const API = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

/** /journal and /journal/new?d=<delivery>: write a few lines; nothing here is visible to anyone else. */
export function Journal() {
  const { user, setUser } = useSession();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const deliveryId = params.get('d');
  const [about, setAbout] = useState<{ body: string; topic: string } | null>(null);
  const [text, setText] = useState('');
  const [mood, setMood] = useState<number | null>(null);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [more, setMore] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const placeholder = SOFT_PROMPTS[new Date().getDate() % SOFT_PROMPTS.length];

  const load = async (before?: string) => { const r = await api<{ entries: Entry[]; more: boolean }>('GET', `/api/journal${before ? `?before=${encodeURIComponent(before)}` : ''}`); setEntries((x) => (before ? [...(x ?? []), ...r.entries] : r.entries)); setMore(r.more); };
  useEffect(() => { if (user) void load(); }, [user]);
  useEffect(() => { if (user && deliveryId) ns.getDelivery(deliveryId).then((d) => setAbout({ body: d.body, topic: d.topic.title })).catch(() => setAbout(null)); }, [user, deliveryId]);

  if (user === undefined) return <p className="muted" aria-busy="true">Loading…</p>;
  if (!user) return <section><h1>Journal</h1><p>A private place to write a few lines. Sign in to start.</p><SignIn onSignedIn={setUser} /></section>;

  const save = async () => {
    setError(null);
    try {
      await api('POST', '/api/journal', { text, mood, deliveryId });
      setText(''); setMood(null); setSaved(true); setTimeout(() => setSaved(false), 2500);
      if (deliveryId) navigate('/journal', { replace: true });
      setAbout(null); await load();
    } catch (e: any) { setError(e.message); }
  };
  return (
    <section className="journal">
      <h1>Journal</h1>
      <div className="compose">
        {about && <blockquote className="about"><span className="muted small">{about.topic}</span>{about.body}</blockquote>}
        <label className="sr-only" htmlFor="jtext">Write</label>
        <textarea id="jtext" rows={6} placeholder={about ? 'What does this bring up for you?' : placeholder} value={text} onChange={(e) => setText(e.target.value)} maxLength={10000} />
        <div className="moods" role="radiogroup" aria-label="How are you feeling? (optional)">
          {MOODS.map((m) => <button key={m.v} type="button" role="radio" aria-checked={mood === m.v} aria-label={m.label} title={m.label} className={'mood m' + m.v + (mood === m.v ? ' on' : '')} onClick={() => setMood(mood === m.v ? null : m.v)} />)}
          <span className="muted small">{mood ? MOODS[mood - 1].label : 'Mood (optional)'}</span>
        </div>
        <div className="row"><span className="muted small" role="status">{saved ? 'Saved.' : 'Only you can read this.'}</span><button className="btn primary" disabled={!text.trim()} onClick={save}>Save</button></div>
        {error && <p className="error" role="alert">{error}</p>}
      </div>

      {entries && entries.length > 0 && (
        <ul className="entries">
          {entries.map((e) => (
            <li key={e.id}>
              <div className="row"><span className="muted small">{new Date(e.ts).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>{e.mood && <span className={'mood m' + e.mood + ' on small-dot'} title={MOODS[e.mood - 1].label} />}</div>
              {e.quote && <blockquote className="about small-quote">{e.quote.body}</blockquote>}
              {e.prompt && <p className="muted small"><em>{e.prompt}</em></p>}
              <p className="entry-text">{e.text}</p>
              <button className="link small" onClick={async () => { await api('DELETE', `/api/journal/${e.id}`); await load(); }}>Delete</button>
            </li>
          ))}
        </ul>
      )}
      {more && <button className="btn secondary" onClick={() => load(entries!.at(-1)!.ts)}>Older entries</button>}

      <details className="journal-more">
        <summary>Reminders</summary>
        <Reminders />
      </details>
      <details className="journal-more">
        <summary>Export or delete</summary>
        <p>Your entries, for you only. Nobody else can export or read them.</p>
        <div className="actions left wrap">
          <a className="btn secondary" href={`${API}/api/journal/export?format=md`} download>Download as text (Markdown)</a>
          <a className="btn secondary" href={`${API}/api/journal/export`} download>Download as JSON</a>
        </div>
        <DeleteAll onDone={() => load()} />
      </details>
    </section>
  );
}

function Reminders() {
  const [r, setR] = useState<Reminder | null>(null);
  const [mode, setMode] = useState<'off' | 'own' | 'tie'>('off');
  const [sched, setSched] = useState({ days: [1, 2, 3, 4, 5, 6, 7], times: ['21:30'] });
  const [topicId, setTopicId] = useState('');
  const [following, setFollowing] = useState<{ id: string; title: string }[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    api<Reminder>('GET', '/api/journal/reminder').then((x) => { setR(x); setMode(x.mode); if (x.slots.length) setSched(fromSlots(x.slots)); if (x.tiedTopicId) setTopicId(x.tiedTopicId); });
    app.enrolments().then((l) => setFollowing(l.filter((e) => e.status === 'active' || e.status === 'paused').map((e) => ({ id: e.topicId, title: e.topicTitle ?? 'Topic' })))).catch(() => undefined);
  }, []);
  if (!r) return <p className="muted">Loading…</p>;
  const save = async () => {
    setMsg(null);
    try {
      await api('PUT', '/api/journal/reminder', mode === 'own' ? { mode, slots: toSlots(sched.days, sched.times), timezone: browserTimezone() } : mode === 'tie' ? { mode, topicId } : { mode });
      setR(await api<Reminder>('GET', '/api/journal/reminder')); setMsg('Saved.');
    } catch (e: any) { setMsg(e.message); }
  };
  return (
    <div>
      <p className="muted small">{r.mode === 'own' ? `Now: ${describeSchedule(r.slots)}, until ${formatDate(r.endDate!)}.` : r.mode === 'tie' ? 'Now: a “Journal on this” button on your notes.' : 'Now: no reminders.'}</p>
      <div className="chips" role="radiogroup" aria-label="Reminders">
        {([['off', 'None'], ['own', 'At my own times'], ['tie', 'On my notes']] as const).map(([v, l]) => <button key={v} role="radio" aria-checked={mode === v} className={'chip' + (mode === v ? ' on' : '')} onClick={() => setMode(v)}>{l}</button>)}
      </div>
      {mode === 'own' && <><SchedulePicker days={sched.days} times={sched.times} maxTimes={3} onChange={setSched} /><p className="muted small">A gentle question arrives at these times, with “Write now” and “Later”. Keep them at least 15 minutes from your other notes.</p></>}
      {mode === 'tie' && (
        following.length ? <label className="field">Add “Journal on this” to the notes of
          <select value={topicId} onChange={(e) => setTopicId(e.target.value)}><option value="">Choose a topic</option>{following.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</select>
          <span className="muted small">No extra notifications: the button replaces “Not for me” (you can still rate on the note’s page).</span></label>
          : <p className="muted">Follow a topic first, then come back.</p>
      )}
      <button className="btn primary" disabled={(mode === 'own' && !scheduleValid(sched.days, sched.times)) || (mode === 'tie' && !topicId)} onClick={save}>Save reminders</button>
      {msg && <p className="small" role="status">{msg}</p>}
      <p className="small"><Link to="/manage">My notes</Link></p>
    </div>
  );
}

function DeleteAll({ onDone }: { onDone: () => void }) {
  const [typed, setTyped] = useState('');
  const [done, setDone] = useState<number | null>(null);
  return (
    <div className="panel">
      <label className="field">To delete every entry, type <strong>delete everything</strong><input value={typed} onChange={(e) => setTyped(e.target.value)} /></label>
      <button className="btn secondary danger" disabled={typed !== 'delete everything'} onClick={async () => { const r = await api<{ deleted: number }>('DELETE', '/api/journal', { confirm: typed }); setDone(r.deleted); setTyped(''); onDone(); }}>Delete all entries</button>
      {done !== null && <p role="status">Deleted {done} entries.</p>}
    </div>
  );
}
