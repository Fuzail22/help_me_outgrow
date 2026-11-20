import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { admin, can, type Role } from './api';
import { useSession } from '../lib/session';
import { SignIn } from '../components/SignIn';
import { Overview } from './Overview';
import { People } from './People';
import { Settings } from './Settings';
import { Admins, Audit } from './Admins';
import { EXTRA_PAGES } from './extra';

export interface AdminMe { email: string; role: Role }
export interface AdminPage { path: string; title: string; min: Role; element: (me: AdminMe) => ReactNode }

const PAGES: AdminPage[] = [
  { path: '', title: 'Overview', min: 'viewer', element: () => <Overview /> },
  { path: 'people', title: 'People', min: 'support', element: (me) => <People me={me} /> },
  ...EXTRA_PAGES,
  { path: 'settings', title: 'Settings', min: 'viewer', element: (me) => <Settings me={me} /> },
  { path: 'admins', title: 'Admins', min: 'owner', element: () => <Admins /> },
  { path: 'audit', title: 'Audit log', min: 'owner', element: () => <Audit /> },
];

/** /admin: signed-in people whose email an owner invited. Roles are enforced by the api on every call. */
export default function Admin() {
  const { user, setUser } = useSession();
  const [me, setMe] = useState<AdminMe | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (user) admin<AdminMe>('GET', '/me').then(setMe).catch((e) => { setMe(null); setError(e.message); }); }, [user]);
  if (user === undefined || (user && me === undefined)) return <p className="muted" aria-busy="true">Loading…</p>;
  if (!user) return <section><h1>Admin</h1><p>Sign in with the Google or Zoho account an owner invited.</p><SignIn next="/admin" onSignedIn={setUser} /></section>;
  if (!me) return <section><h1>Admin</h1><div className="callout warn" role="alert">{error ?? 'This account is not an admin.'}</div></section>;
  const pages = PAGES.filter((p) => can(me, p.min));
  return (
    <section className="admin">
      <nav className="admin-nav" aria-label="Admin">
        {pages.map((p) => <NavLink key={p.path} to={`/admin/${p.path}`} end={p.path === ''}>{p.title}</NavLink>)}
        <span className="muted small">{me.email} · <span className="badge">{me.role}</span></span>
      </nav>
      <Routes>
        {pages.map((p) => <Route key={p.path} path={p.path === '' ? '/' : `${p.path}/*`} element={p.element(me)} />)}
      </Routes>
    </section>
  );
}
