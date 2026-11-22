import { useEffect, useState } from 'react';

/**
 * Android: notes from an installed app are trusted more by Chrome (installed web apps are left out of Chrome's
 * automatic removal of notification permission for "noisy" sites). Offer the install once, quietly.
 */
export function InstallCard() {
  const [can, setCan] = useState(false);
  useEffect(() => {
    const android = /Android/i.test(navigator.userAgent);
    const standalone = matchMedia('(display-mode: standalone)').matches;
    const check = () => { try { setCan(android && !standalone && !!(window as any).__hmoInstall && localStorage.getItem('hmo_install_card') !== 'dismissed'); } catch { setCan(false); } };
    check(); window.addEventListener('hmo-installable', check);
    return () => window.removeEventListener('hmo-installable', check);
  }, []);
  if (!can) return null;
  const dismiss = () => { try { localStorage.setItem('hmo_install_card', 'dismissed'); } catch { /* private mode */ } setCan(false); };
  return (
    <div className="callout" role="note" aria-label="Install the app">
      <strong>Add help me outgrow to your home screen</strong>
      <p>Notes from the installed app arrive more reliably on Android, and Chrome is less likely to mistake them for spam.</p>
      <div className="actions left"><button className="btn primary" onClick={async () => { const p = (window as any).__hmoInstall; dismiss(); if (p) { p.prompt(); await p.userChoice.catch(() => undefined); (window as any).__hmoInstall = null; } }}>Install</button><button className="btn secondary" onClick={dismiss}>Not now</button></div>
    </div>
  );
}
