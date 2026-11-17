import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { HELPLINE_URL, ns } from '../lib/ns';
import { ensureConnected } from '../lib/device';
import { useSession } from '../lib/session';

export function CareNote() {
  return (
    <p className="care">
      These notes are encouragement, not treatment, and not a substitute for professional help. If things feel unsafe or too heavy,{' '}
      <a href={HELPLINE_URL} target="_blank" rel="noreferrer">find a helpline near you</a>.
    </p>
  );
}

/**
 * Reconnects silently on any page when it can; when it cannot (permission withdrawn) and notes are
 * scheduled, shows this one banner. My notes has its own, fuller notice, so the banner is not shown there.
 */
function ConnectionBanner() {
  const { user } = useSession();
  const { pathname } = useLocation();
  const [off, setOff] = useState(false);
  useEffect(() => {
    setOff(false);
    if (!user) return;
    let cancelled = false;
    void ensureConnected().then(async (c) => {
      if (c !== 'off' || cancelled) return;
      const list = await ns.listEnrolments().catch(() => []);
      if (!cancelled) setOff(list.some((e) => e.status === 'active'));
    });
    return () => { cancelled = true; };
  }, [user]);
  if (!off || pathname === '/manage' || pathname === '/start') return null;
  return (
    <div className="callout warn banner" role="alert">
      <strong>Notifications are off on this device.</strong> Your notes are still scheduled. <Link to="/manage">Turn them back on</Link>
    </div>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { user } = useSession();
  return (
    <div className="shell">
      <header className="top">
        <Link to="/" className="brand"><img src="/icons/icon.svg" alt="" width="28" height="28" /> help me outgrow</Link>
        <nav>{user ? <Link to="/manage">My notes</Link> : <Link to="/manage">Sign in</Link>}</nav>
      </header>
      <ConnectionBanner />
      <main>{children}</main>
      <footer>
        <CareNote />
        <p className="muted"><Link to="/privacy">Privacy</Link></p>
      </footer>
    </div>
  );
}
