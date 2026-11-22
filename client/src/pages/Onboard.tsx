import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Config, Enrolment } from '@notification-service/sdk';
import { app, ns, type PublicConfig } from '../lib/ns';
import { NotEnough, type NotEnoughInfo } from '../components/NotEnough';
import { useSession } from '../lib/session';
import { SignIn } from '../components/SignIn';
import { IosGuide } from '../components/IosGuide';
import { rememberDeviceStopped } from '../components/Reconnect';
import { needsHomeScreen } from '../lib/ios';
import { SchedulePicker, scheduleValid } from '../components/SchedulePicker';
import { CareNote } from '../components/Layout';
import { browserTimezone, describeSchedule, DURATIONS, endDateFor, formatDate, formatWhen, lastFittingEnd, notesNeeded, timezones, todayIn, toSlots } from '../lib/time';

type Step = 'topic' | 'times' | 'duration' | 'signin' | 'permission' | 'done';
interface Draft { topicId: string | null; days: number[]; times: string[]; durationDays: number; timezone: string; loop?: boolean; endDate?: string | null }
const DRAFT_KEY = 'hmo_draft';
const loadDraft = (): Draft => {
  try { const d = JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? 'null'); if (d) return d; } catch { /* ignore */ }
  return { topicId: null, days: [1, 2, 3, 4, 5, 6, 7], times: ['08:00'], durationDays: 30, timezone: browserTimezone() };
};
const STEPS: Step[] = ['topic', 'times', 'duration', 'signin', 'permission'];

export function Onboard() {
  const { user, setUser } = useSession();
  const navigate = useNavigate();
  const [config, setConfig] = useState<Config | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [step, setStep] = useState<Step>('topic');
  const [draft, setDraft] = useState<Draft>(loadDraft);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<null | { kind: 'denied' | 'dismissed' | 'ios' | 'unsupported' | 'error'; message?: string }>(null);
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);
  const [interest, setInterest] = useState(false);
  const [pub, setPub] = useState<PublicConfig | null>(null);
  const [short, setShort] = useState<NotEnoughInfo | null>(null);
  // Signed in: the topics this person may follow (their own VAVP3 topics included), from our api.
  const [mine, setMine] = useState<Config['topics'] | null>(null);
  useEffect(() => { if (user) app.limits().then((l) => setMine(l.topics.map((t) => ({ id: t.id, slug: t.slug, title: t.title, description: t.description, itemCount: t.itemCount, sensitive: t.sensitive })))).catch(() => undefined); }, [user]);

  useEffect(() => { ns.getConfig().then(setConfig).catch(() => setLoadError(true)); app.publicConfig().then(setPub).catch(() => undefined); void ns.track('onboard_start'); }, []);
  useEffect(() => { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); }, [draft]);

  const topicList = mine ?? config?.topics ?? [];
  const topic = useMemo(() => topicList.find((t) => t.id === draft.topicId) ?? null, [topicList, draft.topicId]);
  const slots = toSlots(draft.days, draft.times);
  // An end date chosen to fit a short topic wins over the duration chips.
  const endDate = draft.endDate ?? endDateFor(draft.timezone, draft.durationDays);
  const durations = pub?.durations ?? DURATIONS;
  const maxTimes = pub?.baseSlots ?? config?.limits.maxSlots ?? 3;
  // The owner's rule: no schedule that needs more notes than the topic has (unless it loops). Checked again on the server.
  const fits = (d: Draft, t = topic) => {
    if (!t || d.loop) return null;
    const start = todayIn(d.timezone); const end = d.endDate ?? endDateFor(d.timezone, d.durationDays); const sl = toSlots(d.days, d.times);
    const available = Math.min(t.itemCount, pub?.baseItems ?? 90); const needed = notesNeeded(sl, start, end);
    if (needed <= available) return null;
    const perDayTimes = d.times.length; let fewer = perDayTimes;
    while (fewer > 1 && Math.ceil((needed / perDayTimes) * fewer) > available) fewer--;
    return { needed, available, endDate: lastFittingEnd(sl, start, end, available), timesPerDay: Math.ceil((needed / perDayTimes) * fewer) <= available ? fewer : null };
  };
  const tooShort = fits(draft);
  const support = ns.detectSupport();

  const afterSignIn = () => setStep('permission');

  async function turnOn() {
    setBusy(true); setProblem(null);
    try {
      if (!support.supported) { setProblem({ kind: support.reason === 'ios_needs_home_screen' ? 'ios' : 'unsupported' }); void ns.track('unsupported', { reason: support.reason, browser: support.browser, platform: support.platform }); return; }
      void ns.track('permission_prompted', { browser: support.browser, platform: support.platform }, { signedIn: true });
      // Nothing is awaited before this call, so the browser's prompt opens while the click still counts as a user gesture.
      const r = await ns.subscribe();
      if (r.status !== 'subscribed') {
        void ns.track('permission_denied', { result: r.status }, { signedIn: true });
        setProblem({ kind: r.status === 'denied' ? 'denied' : r.status === 'dismissed' ? 'dismissed' : 'unsupported' });
        return;
      }
      rememberDeviceStopped(false);
      void ns.track('permission_granted', {}, { signedIn: true });
      await ns.completeProfile({ timezone: draft.timezone });
      try {
        setEnrolment(await app.createEnrolment({ topicId: draft.topicId!, slots, timezone: draft.timezone, endDate, ...(draft.loop ? { loop: true } : {}) }) as any);
      } catch (e: any) {
        if (e.code === 'already_enrolled') { sessionStorage.removeItem(DRAFT_KEY); navigate('/manage?already=1'); return; }
        if (e.code === 'slot_too_close') { setProblem({ kind: 'error', message: `You already get a note at ${e.details?.conflictsWith} on another topic. Notes need to be at least ${e.details?.gap} minutes apart: go back and pick another time.` }); return; }
        if (e.code === 'not_enough_quotes') { setShort({ needed: e.details.needed, available: e.details.available, endDate: e.details.options.endDate, timesPerDay: e.details.options.timesPerDay }); setStep('duration'); return; }
        throw e;
      }
      sessionStorage.removeItem(DRAFT_KEY);
      setStep('done');
    } catch (e: any) {
      setProblem({ kind: 'error', message: e?.message });
    } finally { setBusy(false); }
  }

  if (loadError) return <section><h1>We could not load the topics</h1><p>Check your connection and <a href="/start">try again</a>.</p></section>;
  if (!config) return <p className="muted" aria-busy="true">Loading…</p>;

  const idx = STEPS.indexOf(step);
  return (
    <section className="onboard">
      {step !== 'done' && (
        <ol className="progress" aria-label="Progress">
          {STEPS.map((s, i) => <li key={s} className={i < idx ? 'past' : i === idx ? 'now' : ''} aria-current={i === idx ? 'step' : undefined} />)}
        </ol>
      )}

      {step === 'topic' && (
        <>
          <h1>What are you going through?</h1>
          <div className="cards">
            {topicList.map((t) => (
              <button key={t.id} className={'card' + (draft.topicId === t.id ? ' on' : '')} aria-pressed={draft.topicId === t.id}
                onClick={() => { setDraft({ ...draft, topicId: t.id }); void ns.track('topic_picked', { topic: t.slug }); setStep('times'); }}>
                <strong>{t.title}</strong><span>{t.description}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {step === 'times' && topic && (
        <>
          <h1>When should a note arrive?</h1>
          <p className="muted">For “{topic.title}”. Choose moments when a few kind words would help most.</p>
          <SchedulePicker days={draft.days} times={draft.times} maxTimes={maxTimes} onChange={(v) => setDraft({ ...draft, ...v, endDate: null })} />
          <div className="actions">
            <button className="btn secondary" onClick={() => setStep('topic')}>Back</button>
            <button className="btn primary" disabled={!scheduleValid(draft.days, draft.times)} onClick={() => { void ns.track('slots_picked', { days: draft.days.length, times: draft.times.length }); setStep('duration'); }}>Continue</button>
          </div>
        </>
      )}

      {step === 'duration' && topic && (
        <>
          <h1>For how long?</h1>
          <div className="chips big" role="radiogroup" aria-label="Duration">
            {durations.map((d) => (
              <button key={d.days} role="radio" aria-checked={!draft.endDate && draft.durationDays === d.days} className={'chip' + (!draft.endDate && draft.durationDays === d.days ? ' on' : '')} onClick={() => { setShort(null); setDraft({ ...draft, durationDays: d.days, endDate: null }); }}>{d.label}</button>
            ))}
          </div>
          <p className="muted">Until {formatDate(endDate)}. You can stop sooner, any time.{draft.loop ? ' When the notes run out, they start again from the first.' : ''}</p>
          {(short ?? tooShort) && (
            <NotEnough info={(short ?? tooShort)!}
              onEndDate={(d) => { setShort(null); setDraft({ ...draft, endDate: d }); }}
              onTimes={(n) => { setShort(null); setDraft({ ...draft, times: draft.times.slice(0, n), endDate: null }); }}
              onLoop={() => { setShort(null); setDraft({ ...draft, loop: true }); }} />
          )}
          <label className="field">Your timezone
            <select value={draft.timezone} onChange={(e) => setDraft({ ...draft, timezone: e.target.value })}>
              {[...new Set([draft.timezone, ...timezones()])].map((z) => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}
            </select>
          </label>
          <p className="muted small">We detected this from your device. Notes follow this timezone, including daylight-saving changes.</p>
          {topic.sensitive && <div className="callout"><CareNote /></div>}
          <div className="actions">
            <button className="btn secondary" onClick={() => setStep('times')}>Back</button>
            <button className="btn primary" disabled={!!(short ?? tooShort)} onClick={() => setStep(user ? 'permission' : 'signin')}>Continue</button>
          </div>
        </>
      )}

      {step === 'signin' && topic && (
        <>
          <h1>{needsHomeScreen() ? 'One step before you sign in' : 'Save your choices'}</h1>
          {!needsHomeScreen() && <p>Sign in so your notes can follow you and you can change or stop them later.</p>}
          <div className="summary"><strong>{topic.title}</strong><span>{describeSchedule(slots)}</span><span>Until {formatDate(endDate)}</span></div>
          {!needsHomeScreen() && (
            <label className="check">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span>I agree to my choices being stored so the notes can be sent, as described in the <Link to="/privacy" target="_blank">privacy notice</Link>.</span>
            </label>
          )}
          {/* iPhone in Safari: sign-in and notifications have to happen inside the Home Screen app (R5). */}
          {needsHomeScreen() ? <IosGuide />
            : consent ? <SignIn onSignedIn={(u) => { setUser(u); afterSignIn(); }} /> : <p className="muted small">Tick the box to continue.</p>}
          <div className="actions"><button className="btn secondary" onClick={() => setStep('duration')}>Back</button></div>
        </>
      )}

      {step === 'permission' && topic && (
        <>
          <h1>One last step: allow notifications</h1>
          <p>Your browser will ask for permission. Choose <strong>Allow</strong>, and your first note arrives at the next time you picked.</p>
          <div className="summary"><strong>{topic.title}</strong><span>{describeSchedule(slots)}</span><span>Until {formatDate(endDate)}</span></div>
          {!user && <p className="error" role="alert">You are signed out. <button className="link" onClick={() => setStep('signin')}>Sign in</button> to continue.</p>}
          <label className="check">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>I agree to my choices being stored so the notes can be sent (<Link to="/privacy" target="_blank">privacy notice</Link>).</span>
          </label>
          {problem?.kind === 'denied' && (
            <div className="callout warn" role="alert">
              <strong>Notifications are blocked for this site.</strong>
              <p>Nothing was saved yet. To turn them on, open the site settings from the padlock or tune icon beside the address bar, set Notifications to Allow, then press the button again.</p>
            </div>
          )}
          {problem?.kind === 'dismissed' && <div className="callout warn" role="alert"><strong>The permission box was closed.</strong><p>Press the button again and choose Allow.</p></div>}
          {problem?.kind === 'ios' && (
            <div className="callout warn" role="alert">
              <strong>On iPhone and iPad, add this site to your Home Screen first.</strong>
              <p>Tap the Share button, choose “Add to Home Screen”, then open help me outgrow from the new icon and come back to this step. A simpler guided setup for iPhone is coming.</p>
              {interest ? <p>Thanks, noted.</p> : <button className="btn secondary" onClick={() => { setInterest(true); void ns.track('ios_interest', {}, { signedIn: !!user }); }}>I would use this on my iPhone</button>}
            </div>
          )}
          {problem?.kind === 'unsupported' && <div className="callout warn" role="alert"><strong>This browser cannot receive notifications from websites.</strong><p>Try Chrome, Edge or Firefox on Android or on a computer.</p></div>}
          {problem?.kind === 'error' && <div className="callout warn" role="alert"><strong>That did not work.</strong><p>{problem.message ?? 'Please try again.'}</p></div>}
          <div className="actions">
            <button className="btn secondary" onClick={() => setStep('duration')}>Back</button>
            <button className="btn primary" disabled={busy || !user || !consent} onClick={turnOn}>{busy ? 'Working…' : problem ? 'Try again' : 'Turn on notifications'}</button>
          </div>
        </>
      )}

      {step === 'done' && enrolment && topic && (
        <div className="done">
          <h1>You are set.</h1>
          <p>Your first note for “{topic.title}” arrives <strong>{enrolment.nextSendAt ? formatWhen(enrolment.nextSendAt, enrolment.timezone) : 'soon'}</strong>.</p>
          <p className="muted">You can close this tab. Notes arrive even when the site is not open, as long as your browser is allowed to show notifications.</p>
          <Link className="btn primary" to="/manage">See my notes</Link>
        </div>
      )}
    </section>
  );
}
