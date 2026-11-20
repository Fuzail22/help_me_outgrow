import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { growth, VAVP_TEXT, TASK_TEXT, type Growth, type Vavp } from '../lib/growth';
import { app, type AppTopic } from '../lib/ns';
import { useSession } from '../lib/session';

/** The padlock opens: the shackle lifts and swings (reduced motion: a fade). */
export function Unlock({ open }: { open: boolean }) {
  return (
    <svg className={'unlock' + (open ? ' open' : '')} viewBox="0 0 64 64" width="88" height="88" aria-hidden="true">
      <path className="shackle" d="M20 30 V20 a12 12 0 0 1 24 0 V30" fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
      <rect x="12" y="28" width="40" height="30" rx="7" fill="currentColor" />
      <circle cx="32" cy="42" r="4" fill="var(--card)" /><rect x="30.5" y="43" width="3" height="7" rx="1.5" fill="var(--card)" />
    </svg>
  );
}

/** One choice for a reached level: which VAVP, and for VAVP1/VAVP2 which topic. */
export function PickChoices({ g, level, topics, onPicked }: { g: Growth; level: number; topics: AppTopic[]; onPicked: (g: Growth) => void }) {
  const l = g.levels.find((x) => x.level === level)!;
  const [vavp, setVavp] = useState<Vavp | null>(null);
  const [topicId, setTopicId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (l.pick) return <p>You chose <strong>{VAVP_TEXT[l.pick.vavp].title}</strong>.</p>;
  if (!l.options.length) return <p className="muted">Nothing to choose at this level.</p>;
  const needsTopic = vavp === 'vavp1' || vavp === 'vavp2';
  const go = async () => {
    setBusy(true); setError(null);
    try { onPicked(await growth.pick(level, vavp!, needsTopic ? topicId : null)); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="pick">
      <p>Choose one:</p>
      <div className="cards" role="radiogroup" aria-label={`Choice for level ${level}`}>
        {l.options.map((o) => (
          <button key={o.vavp} role="radio" aria-checked={vavp === o.vavp} className={'card' + (vavp === o.vavp ? ' on' : '')} onClick={() => setVavp(o.vavp)}>
            <strong>{VAVP_TEXT[o.vavp].title}</strong><span>{VAVP_TEXT[o.vavp].text(o.amount)}</span>
          </button>
        ))}
      </div>
      {needsTopic && (
        <label className="field">For which topic?
          <select value={topicId} onChange={(e) => setTopicId(e.target.value)}><option value="">Choose a topic</option>{topics.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</select>
        </label>
      )}
      <button className="btn primary" disabled={busy || !vavp || (needsTopic && !topicId)} onClick={go}>Unlock it</button>
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}

/** Shown once per reached level, on any page, right after the level is reached. */
export function Celebrate() {
  const { user } = useSession();
  const { pathname } = useLocation();
  const [g, setG] = useState<Growth | null>(null);
  const [topics, setTopics] = useState<AppTopic[]>([]);
  const [opened, setOpened] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!user || pathname.startsWith('/admin') || pathname.startsWith('/r/')) return;
    growth.get().then((x) => { if (x.celebrate.length) { setG(x); app.limits().then((l) => setTopics(l.topics)).catch(() => undefined); } }).catch(() => undefined);
  }, [user, pathname]);
  useEffect(() => {
    if (!g || !dialog.current || dialog.current.open) return;
    dialog.current.showModal?.();
    const t = setTimeout(() => setOpened(true), 350);
    return () => clearTimeout(t);
  }, [g]);
  if (!g?.celebrate.length) return null;
  const level = Math.max(...g.celebrate);
  const l = g.levels.find((x) => x.level === level)!;
  const close = async () => { await growth.celebrated(g.celebrate).catch(() => undefined); dialog.current?.close(); setG(null); setOpened(false); };
  return (
    <dialog ref={dialog} className="celebrate" aria-labelledby="celebrate-title" onCancel={close}>
      <Unlock open={opened} />
      <h2 id="celebrate-title">Level {level} reached</h2>
      <p>Thank you for helping help me outgrow grow. You did it by: {l.tasks.filter((t) => t.have >= t.count).map((t) => TASK_TEXT[t.type](t.count).toLowerCase()).join(', or ')}.</p>
      <PickChoices g={g} level={level} topics={topics} onPicked={(next) => setG({ ...next, celebrate: g.celebrate })} />
      <div className="actions left"><button className="btn secondary" onClick={close}>{l.pick || g.levels.find((x) => x.level === level)?.pick ? 'Done' : 'Later'}</button><Link className="link" to="/growth" onClick={close}>See all levels</Link></div>
    </dialog>
  );
}
