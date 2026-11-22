import type { Store } from './store/schema.js';
import type { Platform } from './platform.js';
import type { Payments } from './payments/index.js';

export interface Identity { sub: string; email: string; name: string; emailVerified: boolean }
export interface Config {
  sessionSecret: string; appOrigin: string; devLogin: boolean; secureCookies: boolean;
  /** Owner of the admin at first sign-in; owners invite everyone else. */
  adminOwnerEmail: string | null;
  /** 64 hex chars: the master key journal entry keys are derived from. */
  journalKey: string;
  /** Public address of this api (Zoho redirect, payment webhooks). */
  publicUrl: string;
  supportEmail: string;
  zoho: { clientId: string | null; clientSecret: string | null; accountsUrl: string };
  googleClientId: string | null;
}
export interface Ctx {
  store: Store; platform: Platform; config: Config; payments: Payments;
  now: () => Date; log: (line: Record<string, unknown>) => void;
  verifyGoogle: (credential: string) => Promise<Identity>;
  zohoSignIn: (input: { code: string; verifier: string; nonce: string; server?: string | null; redirectUri: string }) => Promise<Identity>;
}
