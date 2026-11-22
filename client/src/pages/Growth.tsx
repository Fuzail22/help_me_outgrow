import { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { growth, TASK_TEXT, VAVP_TEXT, type Growth as G } from '../lib/growth';
import { app, type AppTopic } from '../lib/ns';
import { useSession } from '../lib/session';
import { SignIn } from '../components/SignIn';
import { PickChoices, Unlock } from '../components/Celebrate';
import { deviceId, rememberRef } from '../lib/device';

/** /growth: earn more by adding value — levels, tasks, your referral link, and what each level unlocks. */
export function Growth() {
  const { user, setUser } = useSession();
  const [g, setG] = useState<G | null>(null);
  const [topics, setTopics] = useState<AppTopic[]>([]);
  const [copied, setCopied] = useState(false);
  const [sent, setSent] = useState(false);
  useEffect(() => { if (user) { void growth.get().then(setG); void app.limits().then((l) => setTopics(l.topics)); } }, [user]);
  if (user === undefined) return <p className="muted" aria-busy="true">Loading…</p>;
  if (!user) return <section><h1>Grow with us</h1><p>Sign in to see your level and your referral link.</p><SignIn onSignedIn={setUser} /></section>;
  if (!g) return <p className="muted" aria-busy="true">Loading…</p>;
  const share = async () => {
    const data = { title: 'help me outgrow', text: 'Short, kind notes at the times you choose. It has helped me:', url: g.referral.url };
    if (navigator.share) { try { await navigator.share(data); return; } catch { /* cancelled */ } }
    await navigator.clipboard?.writeText(g.referral.url); setCopied(true);
  };
  const subject = encodeURIComponent(`My post about help me outgrow (${g.referral.code})`);
  const body = encodeURIComponent(`Hello,\n\nI posted about help me outgrow. A screenshot is attached.\nWhere I posted it: \nMy referral code: ${g.referral.code}\n`);
  const next = g.levels.find((l) => !l.reached);
  return (
    <section className="growth">
      <h1>Grow with us</h1>
      <p className="lede">Your account grows with the value you add. Each level unlocks one privilege of your choice.</p>
      <div className="summary"><strong>{g.level ? `You are at level ${g.level}` : 'You are just starting'}</strong>{next && <span>Next: level {next.level}</span>}</div>

      <h2>Your link</h2>
      <p>When someone opens it on their own device, it counts for you. When they join, it counts again.</p>
      <div className="reflink"><code>{g.referral.url}</code><button className="btn secondary" onClick={share}>{copied ? 'Copied' : 'Share'}</button></div>
      <p className="muted small">{g.counts.referral_visits} opened · {g.counts.referral_signups} joined</p>

      <h2>Posted about us?</h2>
      <p>Post about help me outgrow on social media, then email a screenshot to <a href={`mailto:${g.supportEmail}?subject=${subject}&body=${body}`}>{g.supportEmail}</a> from <strong>{user.email}</strong>. When our team approves it, it counts as one referral.</p>
      {sent ? <p role="status">Thanks. We will review it soon.</p> : <button className="btn secondary" onClick={async () => { await growth.proof(''); setSent(true); setG(await growth.get()); }}>I have sent the screenshot</button>}
      {g.proofs.length > 0 && <p className="muted small">{g.proofs.filter((p) => p.status === 'pending').length} waiting · {g.proofs.filter((p) => p.status === 'approved').length} approved</p>}

      <h2>Levels</h2>
      <ol className="levels">
        {g.levels.map((l) => (
          <li key={l.level} className={l.reached ? 'reached' : ''}>
            <div className="row"><strong>Level {l.level}</strong>{l.reached ? <Unlock open /> : <span className="badge">{l.mode === 'all' ? 'all of these' : 'any one of these'}</span>}</div>
            <ul className="tasks">{l.tasks.map((t, i) => (
              <li key={i}><span>{TASK_TEXT[t.type](t.count)}</span><progress max={t.count} value={t.have} aria-label={`${t.have} of ${t.count}`} /><span className="muted small">{t.have}/{t.count}</span></li>
            ))}</ul>
            {l.options.length > 0 && !l.reached && <p className="muted small">Unlocks a choice of: {l.options.map((o) => VAVP_TEXT[o.vavp].text(o.amount)).join('; ')}.</p>}
            {l.reached && <PickChoices g={g} level={l.level} topics={topics} onPicked={setG} />}
            {l.pick?.vavp === 'vavp3' && <p><Link to="/my-topic">Write your topic</Link></p>}
          </li>
        ))}
      </ol>
      <p className="muted small">Prefer not to wait? <Link to="/upgrade">Paid options</Link> are on their own page.</p>
    </section>
  );
}

/** /r/:code — someone opened a referral link. Count it (from this device), remember it for sign-up, go to the start. */
export function Referral() {
  const { code } = useParams();
  const navigate = useNavigate();
  useEffect(() => {
    if (!code || !/^[a-z0-9]{4,16}$/.test(code)) { navigate('/', { replace: true }); return; }
    rememberRef(code);
    growth.visit(code, deviceId()).catch(() => undefined).finally(() => navigate('/?welcome=1', { replace: true }));
  }, [code, navigate]);
  return <p className="muted" aria-busy="true">Opening…</p>;
}
