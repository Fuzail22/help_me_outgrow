import { useNavigate, useSearchParams } from 'react-router-dom';
import { SignIn } from '../components/SignIn';
import { useSession } from '../lib/session';

const PROBLEMS: Record<string, string> = {
  state: 'The sign-in took too long or was finished in another tab. Please try again.',
  email_unverified: 'That account has no verified email address. Verify it with the provider, or use another account.',
  cancelled: 'Sign-in was cancelled.', access_denied: 'Sign-in was cancelled.',
};
/** Where a failed Zoho sign-in comes back to, and a plain sign-in page for links. */
export function SignInPage() {
  const [params] = useSearchParams();
  const { setUser } = useSession();
  const navigate = useNavigate();
  const error = params.get('error');
  return (
    <section>
      <h1>Sign in</h1>
      {error && <div className="callout warn" role="alert">{PROBLEMS[error] ?? 'Sign-in did not complete. Please try again.'}</div>}
      <SignIn next={params.get('next') ?? '/manage'} onSignedIn={(u) => { setUser(u); navigate(params.get('next') ?? '/manage'); }} />
    </section>
  );
}
