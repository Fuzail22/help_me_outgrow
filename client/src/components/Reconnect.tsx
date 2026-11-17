import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ns } from '../lib/ns';
import { useSession } from '../lib/session';

const DISMISSED = 'hmo_reconnect_dismissed';
export const RECONNECTED = 'hmo-reconnected';

/**
 * R5: if this device's push subscription was lost while notification permission is still granted (an iOS or
 * browser reset), subscribe again silently. Otherwise, when someone still has notes running, show one banner.
 * Runs once per page load for a signed-in person.
 */
export function Reconnect() {
  const { user } = useSession();
  const { pathname } = useLocation();
  const [banner, setBanner] = useState(false);
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const support = ns.detectSupport();
      if (!support.supported) return; // iPhone in Safari: the Home Screen guide covers it
      const live = (await ns.listEnrolments()).filter((e) => e.status === 'active' || e.status === 'paused');
      if (!live.length) return;
      const [me, sub] = await Promise.all([ns.getMe(), ns.currentSubscription()]);
      const ok = sub && me.devices.some((d) => d.endpoint === sub.endpoint && d.status === 'active');
      if (ok && ns.permission() === 'granted') return;
      if (ns.permission() === 'granted') {
        // Permission is still granted, so this asks nothing of the person: it only re-creates the subscription.
        const r = await ns.subscribe().catch(() => null);
        if (r?.status === 'subscribed') { window.dispatchEvent(new Event(RECONNECTED)); return; }
      }
      let dismissed = false;
      try { dismissed = sessionStorage.getItem(DISMISSED) === '1'; } catch { /* ignore */ }
      if (!cancelled && !dismissed) setBanner(true);
    })().catch(() => undefined);
    return () => { cancelled = true; };
  }, [user]);
  if (!banner || pathname === '/manage') return null;
  return (
    <div className="callout warn reconnect" role="status" aria-label="Notifications are off">
      <strong>Notifications are off on this device</strong>, so your notes cannot arrive here.{' '}
      <Link to="/manage">Turn them back on</Link>{' '}
      <button className="link" onClick={() => { setBanner(false); try { sessionStorage.setItem(DISMISSED, '1'); } catch { /* ignore */ } }}>Dismiss</button>
    </div>
  );
}
