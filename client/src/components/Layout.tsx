import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { HELPLINE_URL } from '../lib/ns';
import { useSession } from '../lib/session';
import { Reconnect } from './Reconnect';

export function CareNote() {
  return (
    <p className="care">
      These notes are encouragement, not treatment, and not a substitute for professional help. If things feel unsafe or too heavy,{' '}
      <a href={HELPLINE_URL} target="_blank" rel="noreferrer">find a helpline near you</a>.
    </p>
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
      <Reconnect />
      <main>{children}</main>
      <footer>
        <CareNote />
        <p className="muted"><Link to="/privacy">Privacy</Link></p>
      </footer>
    </div>
  );
}
