import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { SessionProvider } from './lib/session';
import { ns } from './lib/ns';
import { Layout } from './components/Layout';
import { Landing } from './pages/Landing';
import { Onboard } from './pages/Onboard';
import { Manage } from './pages/Manage';
import { Quote } from './pages/Quote';
import { Privacy } from './pages/Privacy';
import { Next } from './pages/Next';
import { SignInPage } from './pages/SignInPage';

// The admin is loaded only when someone opens it.
const Admin = lazy(() => import('./admin/Admin'));
import './styles.css';

// Deep link restored by 404.html on static hosts without rewrite rules.
const redirect = sessionStorage.getItem('hmo_redirect');
if (redirect) { sessionStorage.removeItem('hmo_redirect'); history.replaceState(null, '', redirect); }

// Keep the browser's install prompt so the quote page can offer it later.
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); (window as any).__hmoInstall = e; window.dispatchEvent(new Event('hmo-installable')); });
window.addEventListener('appinstalled', () => { void ns.track('installed', {}, { signedIn: true }); });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <SessionProvider>
        <Layout>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/start" element={<Onboard />} />
            <Route path="/manage" element={<Manage />} />
            <Route path="/n/:deliveryId" element={<Quote />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/next/:id" element={<Next />} />
            <Route path="/signin" element={<SignInPage />} />
            <Route path="/admin/*" element={<Suspense fallback={<p className="muted">Loading…</p>}><Admin /></Suspense>} />
            <Route path="*" element={<Landing />} />
          </Routes>
        </Layout>
      </SessionProvider>
    </BrowserRouter>
  </StrictMode>,
);
