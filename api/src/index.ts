import { OAuth2Client } from 'google-auth-library';
import { z } from 'zod';
import { createApp } from './app.js';
import { createFileUserStore, createMongoUserStore } from './users.js';

const env = z.object({
  PORT: z.coerce.number().default(8787),
  SESSION_SECRET: z.string().min(32),
  APP_ORIGIN: z.string().url(),
  PLATFORM_API_URL: z.string().url(),
  PLATFORM_SECRET_KEY: z.string().startsWith('sk_'),
  GOOGLE_CLIENT_ID: z.string().optional(),
  DEV_LOGIN: z.enum(['0', '1']).optional(),
  MONGO_URI: z.string().optional(),
  USERS_FILE: z.string().optional(),
  NODE_ENV: z.string().optional(),
}).parse(process.env);
const devLogin = env.DEV_LOGIN === '1';
// The dev login is a password-less sign-in: explicit '1' only, never in production, never next to a real database.
if (devLogin && (env.NODE_ENV === 'production' || env.MONGO_URI)) throw new Error('DEV_LOGIN must not be enabled in production or with MONGO_URI');
if (!env.GOOGLE_CLIENT_ID && !devLogin) throw new Error('Set GOOGLE_CLIENT_ID (or DEV_LOGIN=1 for local development)');

const google = new OAuth2Client();
const app = createApp({
  users: env.MONGO_URI ? await createMongoUserStore(env.MONGO_URI) : createFileUserStore(env.USERS_FILE),
  async verifyGoogle(credential) {
    if (!env.GOOGLE_CLIENT_ID) throw new Error('Google sign-in is not configured');
    const p = (await google.verifyIdToken({ idToken: credential, audience: env.GOOGLE_CLIENT_ID })).getPayload();
    if (!p?.sub || !p.email || !p.email_verified) throw new Error('unverified');
    return { googleId: p.sub, email: p.email, name: p.name ?? p.email.split('@')[0] };
  },
  async platformToken(externalId) {
    const r = await fetch(`${env.PLATFORM_API_URL.replace(/\/$/, '')}/v1/subscriber-tokens`, {
      method: 'POST', headers: { authorization: `Bearer ${env.PLATFORM_SECRET_KEY}`, 'content-type': 'application/json' }, body: JSON.stringify({ externalId }),
    });
    if (!r.ok) throw new Error(`platform token exchange failed: ${r.status}`);
    const b = (await r.json()) as { token: string; expiresIn: number };
    return { token: b.token, expiresIn: b.expiresIn };
  },
  config: { sessionSecret: env.SESSION_SECRET, appOrigin: env.APP_ORIGIN, devLogin, secureCookies: env.APP_ORIGIN.startsWith('https://') },
});
app.listen(env.PORT, () => console.log(JSON.stringify({ msg: 'listening', port: env.PORT, devLogin })));
