import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { app, type AppEnrolment, type Limits } from '../lib/ns';
import { useSession } from '../lib/session';
import { SignIn } from '../components/SignIn';
import { describeSchedule, formatDate } from '../lib/time';

/** G6: reached from the "Choose what's next" button in the last days of a course (or from My notes). */
export function Next() {
  const { id } = useParams();
  const { user, setUser } = useSession();
  const navigate = useNavigate();
  const [e, setE] = useState<AppEnrolment | null | undefined>(undefined);
  const [limits, setLimits] = useState<Limits | null>(null);
  const [topicId, setTopicId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    Promise.all([app.enrolments(), app.limits()]).then(([list, lim]) => { setE(list.find((x) => x.id === id) ?? null); setLimits(lim); }).catch(() => setE(null));
  }, [user, id]);

  if (user === undefined) return <p className="muted" aria-busy="true">Loading…</p>;
  if (!user) return <section><h1>Sign in to choose what’s next</h1><SignIn onSignedIn={setUser} /></section>;
  if (e === undefined) return <p className="muted" aria-busy="true">Loading…</p>;
  if (e === null) return <section><h1>We could not find that course</h1><p><Link to="/manage">See my notes</Link></p></section>;

  const choose = async (choice: 'loop' | 'extend' | 'new') => {
    setBusy(true); setError(null);
    try { await app.next(e.id, { choice, ...(choice === 'new' ? { topicId } : {}) }); navigate('/manage?next=' + choice); }
    catch (err: any) { setError(err?.message ?? 'That did not work.'); } finally { setBusy(false); }
  };
  const tl = limits?.perTopic[e.topicId];
  const canExtend = !!tl && tl.maxItems > (e.maxItems ?? 0) && tl.itemsAvailable > (e.maxItems ?? 0);
  const others = limits?.topics.filter((t) => t.id !== e.topicId) ?? [];
  return (
    <section className="next">
      <h1>{e.status === 'completed' ? 'Your notes have finished' : 'Your notes are about to end'}</h1>
      <div className="summary"><strong>{e.topicTitle}</strong><span>{describeSchedule(e.slots)}</span><span>Until {formatDate(e.endDate)}</span></div>
      <p>What would you like next? Your times stay the same; you can change them later.</p>
      <div className="cards">
        <div className="card">
          <strong>Go through it again</strong>
          <span>Start “{e.topicTitle}” again from the first note, and keep going round.</span>
          <button className="btn primary" disabled={busy} onClick={() => choose('loop')}>Loop again</button>
        </div>
        <div className="card">
          <strong>More notes on this topic</strong>
          {canExtend ? (<><span>You have {tl!.maxItems - (e.maxItems ?? 0)} more notes unlocked for this topic.</span><button className="btn primary" disabled={busy} onClick={() => choose('extend')}>Add them</button></>)
            : (<><span>Unlock more notes by helping the app grow, or add them on the upgrade page.</span><Link className="btn secondary" to="/growth">How to unlock</Link></>)}
        </div>
        <div className="card">
          <strong>Start a new course</strong>
          <label className="field">Topic
            <select value={topicId} onChange={(ev) => setTopicId(ev.target.value)}>
              <option value="">Choose a topic</option>
              {others.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
            </select>
          </label>
          <button className="btn primary" disabled={busy || !topicId} onClick={() => choose('new')}>Start</button>
        </div>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <p className="muted small"><Link to="/manage">Not now</Link></p>
    </section>
  );
}
