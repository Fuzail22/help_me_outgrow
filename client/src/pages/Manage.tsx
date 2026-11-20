import { useCallback, useEffect, useState } from 'react';
import { IosGuide } from '../components/IosGuide';
import { RECONNECTED, rememberDeviceStopped } from '../components/Reconnect';
import { needsHomeScreen } from '../lib/ios';
import { Link, useSearchParams } from 'react-router-dom';
import type { Me } from '@notification-service/sdk';
import { api, app, auth, ns, type AppEnrolment as Enrolment, type EnrolmentPatch, type Limits } from '../lib/ns';
import { useSession } from '../lib/session';
import { SignIn } from '../components/SignIn';
import { InstallCard } from '../components/InstallCard';
import { SchedulePicker, scheduleValid } from '../components/SchedulePicker';
import { describeSchedule, formatDate, formatWhen, fromSlots, todayIn, toSlots } from '../lib/time';

/** Days left including today; the "what's next" choice shows from 3 days before the end. */
const daysLeft = (e: Enrolment) => Math.round((Date.parse(e.endDate + 'T00:00:00Z') - Date.parse(todayIn(e.timezone) + 'T00:00:00Z')) / 86400000) + 1;
const notesLeft = (e: Enrolment) => (e.loop ? Infinity : Math.min(e.itemsAvailable - e.position, (e.maxItems ?? Infinity) - e.sentCount));

const REASONS = [['too_many', 'Too many notes'], ['wrong_tone', 'The tone was not right'], ['feeling_better', 'I am feeling better'], ['other', 'Something else']] as const;
type DeviceState = 'checking' | 'on' | 'off' | 'blocked' | 'unsupported';

const live = (e: Enrolment) => e.status === 'active' || e.status === 'paused';
function EnrolmentCard({ e, maxTimes, onChanged }: { e: Enrolment; maxTimes: number; onChanged: () => Promise<void> }) {
  const [mode, setMode] = useState<'view' | 'edit' | 'stop'>('view');
  const [sched, setSched] = useState(() => fromSlots(e.slots));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (patch: EnrolmentPatch) => {
    setBusy(true); setError(null);
    try { await app.updateEnrolment(e.id, patch); await onChanged(); setMode('view'); } catch (err: any) { setError(err?.message ?? 'That did not work.'); } finally { setBusy(false); }
  };
  const ending = e.status === 'completed' || (live(e) && (daysLeft(e) <= 3 || notesLeft(e) <= 3 * Math.max(1, e.slots.length / 7)));
  const isLive = live(e);
  return (
    <li className={'enrolment ' + e.status}>
      <div className="row">
        <strong>{e.topicTitle}</strong>
        <span className={'badge ' + e.status}>{{ active: 'On', paused: 'Paused', completed: 'Finished', cancelled: 'Stopped' }[e.status]}</span>
      </div>
      <p>{describeSchedule(e.slots)} <span className="muted">· until {formatDate(e.endDate)}</span></p>
      {e.status === 'active' && e.nextSendAt && <p className="muted small">Next note: {formatWhen(e.nextSendAt, e.timezone)} · {e.sentCount || e.position} sent so far{e.maxItems && !e.loop ? ` of ${Math.min(e.maxItems, e.itemsAvailable)}` : ''}</p>}
      {ending && e.status !== 'cancelled' && <p className="callout"><Link to={`/next/${e.id}`}>{e.status === 'completed' ? 'Finished. Choose what’s next' : 'About to end. Choose what’s next'}</Link></p>}
      {mode === 'view' && isLive && (
        <div className="actions left">
          {e.status === 'active' ? <button className="btn secondary" disabled={busy} onClick={() => run({ action: 'pause' })}>Pause</button>
            : <button className="btn primary" disabled={busy} onClick={() => run({ action: 'resume' })}>Resume</button>}
          <button className="btn secondary" disabled={busy} onClick={() => setMode('edit')}>Change times</button>
          <button className="btn secondary danger" disabled={busy} onClick={() => setMode('stop')}>Stop</button>
        </div>
      )}
      {mode === 'edit' && (
        <div className="panel">
          <SchedulePicker days={sched.days} times={sched.times} maxTimes={maxTimes} onChange={setSched} />
          <div className="actions left">
            <button className="btn secondary" onClick={() => setMode('view')}>Cancel</button>
            <button className="btn primary" disabled={busy || !scheduleValid(sched.days, sched.times)} onClick={() => run({ slots: toSlots(sched.days, sched.times) })}>Save times</button>
          </div>
        </div>
      )}
      {mode === 'stop' && (
        <div className="panel">
          <label className="field">Stop these notes? If you like, tell us why (optional)
            <select value={reason} onChange={(ev) => setReason(ev.target.value)}>
              <option value="">Prefer not to say</option>
              {REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <div className="actions left">
            <button className="btn secondary" onClick={() => setMode('view')}>Keep them</button>
            <button className="btn primary danger" disabled={busy} onClick={() => run({ action: 'cancel', ...(reason ? { reason } : {}) })}>Stop notes</button>
          </div>
        </div>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </li>
  );
}

export function Manage() {
  const { user, setUser } = useSession();
  const [params] = useSearchParams();
  const [me, setMe] = useState<Me | null>(null);
  const [enrolments, setEnrolments] = useState<Enrolment[] | null>(null);
  const [limits, setLimits] = useState<Limits | null>(null);
  const [ending, setEnding] = useState(0);
  const [device, setDevice] = useState<DeviceState>('checking');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(params.get('already') ? 'You already follow that topic. Change its times below.' : null);
  const [confirmErase, setConfirmErase] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [m, list, lim] = await Promise.all([ns.getMe(), app.enrolments(), app.limits()]);
      setMe(m); setEnrolments(list); setLimits(lim);
      // Paid privileges ending within 3 days: one quiet reminder.
      api<{ mine: { endingSoon: boolean }[] }>('GET', '/api/upgrade/catalog').then((c) => setEnding(c.mine.filter((x) => x.endingSoon).length)).catch(() => undefined);
      const support = ns.detectSupport();
      if (!support.supported) return setDevice('unsupported');
      if (ns.permission() === 'denied') return setDevice('blocked');
      const sub = await ns.currentSubscription();
      const mine = sub && m.devices.find((d) => d.endpoint === sub.endpoint);
      setDevice(mine && mine.status === 'active' && ns.permission() === 'granted' ? 'on' : 'off');
    } catch { setError('We could not load your notes. Check your connection and reload.'); }
  }, []);
  useEffect(() => { if (user) void load(); }, [user, load]);
  // A silent reconnect (components/Reconnect) re-registers this device: show the fresh state.
  useEffect(() => { const f = () => { if (user) void load(); }; window.addEventListener(RECONNECTED, f); return () => window.removeEventListener(RECONNECTED, f); }, [user, load]);

  if (user === undefined) return <p className="muted" aria-busy="true">Loading…</p>;
  if (!user) {
    return (
      <section>
        <h1>Sign in to see your notes</h1>
        <IosGuide />
        {!needsHomeScreen() && <SignIn onSignedIn={setUser} />}
        <p className="muted">New here? <Link to="/start">Choose what you need</Link>.</p>
      </section>
    );
  }

  const turnOn = async () => {
    setBusy(true); setNotice(null);
    try {
      const r = await ns.subscribe();
      if (r.status === 'subscribed') { rememberDeviceStopped(false); setNotice('Notifications are back on for this device.'); await load(); }
      else if (r.status === 'denied') setDevice('blocked');
      else setNotice('The permission box was closed. Try again and choose Allow.');
    } finally { setBusy(false); }
  };
  const turnOff = async () => { setBusy(true); try { await ns.unsubscribe(); rememberDeviceStopped(true); setNotice('This device will no longer receive notes.'); await load(); } finally { setBusy(false); } };
  const erase = async () => {
    setBusy(true);
    try {
      const sub = await ns.currentSubscription(); await sub?.unsubscribe().catch(() => undefined);
      await ns.eraseMe(); await auth.deleteAccount(); setUser(null);
    } catch { setError('Erasing did not finish. Please try again.'); } finally { setBusy(false); }
  };

  const live = enrolments?.filter((e) => e.status === 'active' || e.status === 'paused') ?? [];
  const past = enrolments?.filter((e) => e.status === 'completed' || e.status === 'cancelled') ?? [];
  return (
    <section className="manage">
      <h1>My notes</h1>
      <p className="muted">Signed in as {user.name}</p>
      {notice && <div className="callout" role="status">{notice}</div>}
      {live.length > 0 && <InstallCard />}
      {ending > 0 && <div className="callout" role="status">{ending === 1 ? 'A paid privilege ends' : `${ending} paid privileges end`} in under 3 days. <Link to="/upgrade">Renew</Link> or keep growing on <Link to="/growth">Grow with us</Link>.</div>}
      {error && <div className="callout warn" role="alert">{error}</div>}

      {device === 'off' && live.length > 0 && (
        <div className="callout warn" role="alert">
          <strong>Notifications are off on this device.</strong>
          <p>Your notes are still scheduled, but this browser cannot receive them right now.</p>
          <button className="btn primary" disabled={busy} onClick={turnOn}>Turn back on</button>
        </div>
      )}
      {device === 'blocked' && (
        <div className="callout warn" role="alert">
          <strong>Notifications are blocked for this site.</strong>
          <p>Open the site settings from the icon beside the address bar, set Notifications to Allow, then reload this page.</p>
        </div>
      )}
      {device === 'unsupported' && <div className="callout warn"><strong>This browser cannot receive notes.</strong><p>You can still change or stop them here.</p></div>}

      {enrolments === null ? <p className="muted" aria-busy="true">Loading…</p> : (
        <>
          {live.length === 0 && <p>You have no notes scheduled right now.</p>}
          <ul className="enrolments">{live.map((e) => <EnrolmentCard key={e.id} e={e} maxTimes={limits?.perTopic[e.topicId]?.maxSlots ?? me?.maxSlots ?? 3} onChanged={load} />)}</ul>
          <Link className="btn secondary" to="/start">Add a topic</Link>
          {past.length > 0 && (<><h2>Earlier</h2><ul className="enrolments">{past.map((e) => <EnrolmentCard key={e.id} e={e} maxTimes={3} onChanged={load} />)}</ul></>)}
        </>
      )}

      <h2>This device and your data</h2>
      <div className="actions left wrap">
        {device === 'on' && <button className="btn secondary" disabled={busy} onClick={turnOff}>Stop notes on this device</button>}
        {device === 'off' && live.length === 0 && <button className="btn secondary" disabled={busy} onClick={turnOn}>Turn on notifications</button>}
        <button className="btn secondary" disabled={busy} onClick={async () => { await auth.logout(); setUser(null); }}>Sign out</button>
        {!confirmErase && <button className="btn secondary danger" onClick={() => setConfirmErase(true)}>Erase my data</button>}
      </div>
      {confirmErase && (
        <div className="callout warn" role="alertdialog" aria-label="Erase my data">
          <strong>Erase everything?</strong>
          <p>This deletes your account, schedule, this device's registration and your history, straight away. It cannot be undone.</p>
          <div className="actions left">
            <button className="btn secondary" onClick={() => setConfirmErase(false)}>Keep my data</button>
            <button className="btn primary danger" disabled={busy} onClick={erase}>Erase my data</button>
          </div>
        </div>
      )}
    </section>
  );
}
