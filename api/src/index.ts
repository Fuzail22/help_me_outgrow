import { OAuth2Client } from 'google-auth-library';
import { z } from 'zod';
import { createApp } from './app.js';
import type { Ctx } from './context.js';
import { createPlatform } from './platform.js';
import { createMemoryStore } from './store/memory.js';
import { createMongoStore } from './store/mongo.js';
import { createPayments } from './payments/index.js';
import { createZohoSignIn } from './auth/zoho.js';

const env = z.object({
  PORT: z.coerce.number().default(8787),
  SESSION_SECRET: z.string().min(32),
  APP_ORIGIN: z.string().url(),
  /** This api's own public address (Zoho redirect, payment webhooks). Defaults to http://localhost:PORT. */
  PUBLIC_URL: z.string().url().optional(),
  PLATFORM_API_URL: z.string().url(),
  PLATFORM_SECRET_KEY: z.string().startsWith('sk_'),
  GOOGLE_CLIENT_ID: z.string().optional(),
  ZOHO_CLIENT_ID: z.string().optional(),
  ZOHO_CLIENT_SECRET: z.string().optional(),
  ZOHO_ACCOUNTS_URL: z.string().url().default('https://accounts.zoho.in'),
  ADMIN_OWNER_EMAIL: z.string().email().optional(),
  /** 64 hex chars (openssl rand -hex 32). Journal entries are encrypted with keys derived from it; never change it. */
  JOURNAL_KEY: z.string().regex(/^[0-9a-f]{64}$/i).optional(),
  SUPPORT_EMAIL: z.string().email().default('support@htsta.com'),
  DEV_LOGIN: z.enum(['0', '1']).optional(),
  MONGO_URI: z.string().optional(),
  /** In-memory store snapshot for local runs (replaces the old USERS_FILE). */
  STORE_FILE: z.string().optional(),
  USERS_FILE: z.string().optional(),
  NODE_ENV: z.string().optional(),
  /** Razorpay (India: UPI, cards, netbanking, wallets). Test keys start rzp_test_. */
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  /** 1 once "International payments" is activated on the Razorpay account: visitors outside India pay in USD there. */
  RAZORPAY_INTERNATIONAL: z.enum(['0', '1']).optional(),
  /** Stripe Checkout (outside India). Test keys start sk_test_. */
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  /** Local development and tests only: a fake checkout page instead of a provider. */
  PAYMENTS_MOCK: z.enum(['0', '1']).optional(),
}).parse(process.env);
if (env.PAYMENTS_MOCK === '1' && env.NODE_ENV === 'production') throw new Error('PAYMENTS_MOCK must not be enabled in production');
const devLogin = env.DEV_LOGIN === '1';
// The dev login is a password-less sign-in: explicit '1' only, never in production, never next to a real database.
if (devLogin && (env.NODE_ENV === 'production' || env.MONGO_URI)) throw new Error('DEV_LOGIN must not be enabled in production or with MONGO_URI');
if (!env.GOOGLE_CLIENT_ID && !env.ZOHO_CLIENT_ID && !devLogin) throw new Error('Set GOOGLE_CLIENT_ID or ZOHO_CLIENT_ID (or DEV_LOGIN=1 for local development)');
if (env.NODE_ENV === 'production' && !env.JOURNAL_KEY) throw new Error('JOURNAL_KEY is required in production');

const google = new OAuth2Client();
const store = env.MONGO_URI ? await createMongoStore(env.MONGO_URI) : createMemoryStore({ file: env.STORE_FILE ?? env.USERS_FILE });
const ctx = {
  store, now: () => new Date(), log: (l: Record<string, unknown>) => console.log(JSON.stringify({ t: new Date().toISOString(), ...l })),
  platform: createPlatform({ url: env.PLATFORM_API_URL, secretKey: env.PLATFORM_SECRET_KEY }),
  payments: createPayments({
    razorpay: env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET ? { keyId: env.RAZORPAY_KEY_ID, keySecret: env.RAZORPAY_KEY_SECRET, webhookSecret: env.RAZORPAY_WEBHOOK_SECRET ?? null } : null,
    stripe: env.STRIPE_SECRET_KEY ? { secretKey: env.STRIPE_SECRET_KEY, webhookSecret: env.STRIPE_WEBHOOK_SECRET ?? null } : null,
    mockOrigin: env.PAYMENTS_MOCK === '1' ? env.APP_ORIGIN : null,
    razorpayInternational: env.RAZORPAY_INTERNATIONAL === '1',
  }),
  config: {
    sessionSecret: env.SESSION_SECRET, appOrigin: env.APP_ORIGIN, devLogin, secureCookies: env.APP_ORIGIN.startsWith('https://'),
    adminOwnerEmail: env.ADMIN_OWNER_EMAIL?.toLowerCase() ?? null,
    // Local runs without a key get a throwaway one (entries do not survive a restart's key change: dev only).
    journalKey: env.JOURNAL_KEY ?? 'd'.repeat(64),
    publicUrl: (env.PUBLIC_URL ?? `http://localhost:${env.PORT}`).replace(/\/$/, ''), supportEmail: env.SUPPORT_EMAIL,
    zoho: { clientId: env.ZOHO_CLIENT_ID ?? null, clientSecret: env.ZOHO_CLIENT_SECRET ?? null, accountsUrl: env.ZOHO_ACCOUNTS_URL },
    googleClientId: env.GOOGLE_CLIENT_ID ?? null,
  },
  async verifyGoogle(credential: string) {
    if (!env.GOOGLE_CLIENT_ID) throw new Error('Google sign-in is not configured');
    const p = (await google.verifyIdToken({ idToken: credential, audience: env.GOOGLE_CLIENT_ID })).getPayload();
    if (!p?.sub || !p.email) throw new Error('unverified');
    return { sub: p.sub, email: p.email, name: p.name ?? p.email.split('@')[0], emailVerified: !!p.email_verified };
  },
} as Ctx;
const zoho = createZohoSignIn(() => ctx.config.zoho, { now: () => new Date() });
ctx.zohoSignIn = async (input) => { const z = await zoho(input); return { sub: z.sub, email: z.email, name: z.name ?? z.email.split('@')[0], emailVerified: z.emailVerified }; };
const app = createApp(ctx);
app.listen(env.PORT, () => console.log(JSON.stringify({ msg: 'listening', port: env.PORT, devLogin })));
