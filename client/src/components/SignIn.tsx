import { useEffect, useRef, useState } from 'react';
import { auth, DEV_LOGIN, GOOGLE_CLIENT_ID, type User } from '../lib/ns';

declare global { interface Window { google?: any } }

function loadGoogle(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.onload = () => resolve(); s.onerror = () => reject(new Error('Could not load Google sign-in'));
    document.head.appendChild(s);
  });
}

let zohoConfigured: Promise<boolean> | null = null;
/** Google (one tap) or Zoho (a redirect and back). The dev button exists only in local builds. */
export function SignIn({ onSignedIn, next }: { onSignedIn: (u: User) => void; next?: string }) {
  const holder = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [zoho, setZoho] = useState(false);
  useEffect(() => { (zohoConfigured ??= auth.config().then((c) => c.zoho).catch(() => false)).then(setZoho); }, []);

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;
    let cancelled = false;
    loadGoogle().then(() => {
      if (cancelled || !holder.current) return;
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: async (r: { credential: string }) => {
          setBusy(true); setError(null);
          try { onSignedIn(await auth.google(r.credential)); } catch { setError('Google sign-in did not go through. Please try again.'); } finally { setBusy(false); }
        },
      });
      window.google.accounts.id.renderButton(holder.current, { theme: 'outline', size: 'large', shape: 'pill', text: 'continue_with' });
    }).catch(() => setError('Google sign-in could not be loaded. Check your connection and reload.'));
    return () => { cancelled = true; };
  }, [onSignedIn]);

  return (
    <div className="signin">
      {GOOGLE_CLIENT_ID && <div ref={holder} aria-busy={busy} />}
      {zoho && <a className="btn secondary" href={auth.zohoUrl(next ?? location.pathname + location.search)}>Continue with Zoho</a>}
      {DEV_LOGIN && (
        <button className="btn secondary" disabled={busy} onClick={async () => {
          setBusy(true); setError(null);
          try { onSignedIn(await auth.dev('Demo user')); } catch { setError('Sign-in failed.'); } finally { setBusy(false); }
        }}>Continue as demo user</button>
      )}
      {!GOOGLE_CLIENT_ID && !DEV_LOGIN && !zoho && <p className="error" role="alert">Sign-in is not configured for this build.</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
