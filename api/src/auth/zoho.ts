// Zoho OpenID Connect sign-in. Same approach as the notification platform console (copied: the repositories share no code).
import { createHash, createHmac, createPublicKey, randomBytes, timingSafeEqual, verify, type JsonWebKey } from 'node:crypto';
import { HttpError } from '../http.js';

/**
 * Zoho sign-in (OpenID Connect, authorization code + PKCE). Zoho has no one-tap button like Google's, so the
 * browser is redirected to Zoho and back; the code is exchanged here with the client secret and the ID token is
 * verified against Zoho's published keys (RS256): signature, issuer, audience, expiry and the nonce we sent.
 *
 * Zoho runs separate data centres (accounts.zoho.com, .in, .eu, …). The callback names the one that signed the
 * person in (`accounts-server`); only https Zoho account hosts are accepted.
 */
export interface ZohoConfig { clientId: string | null; clientSecret: string | null; accountsUrl: string }
export interface ZohoIdentity { email: string; emailVerified: boolean; sub: string; name: string | null }
type Jwk = JsonWebKey & { kid?: string };

const b64json = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
/** Zoho's account data centres (an explicit list: a pattern would also match accounts.zoho.com.evil.example). */
export const ZOHO_ACCOUNT_HOSTS = new Set(['accounts.zoho.com', 'accounts.zoho.in', 'accounts.zoho.eu', 'accounts.zoho.com.au', 'accounts.zoho.jp',
  'accounts.zohocloud.ca', 'accounts.zoho.sa', 'accounts.zoho.uk', 'accounts.zoho.com.cn']);
export const isZohoAccountsHost = (u: string) => { try { const x = new URL(u); return x.protocol === 'https:' && ZOHO_ACCOUNT_HOSTS.has(x.hostname) && !x.port && x.pathname === '/'; } catch { return false; } };

export function pkce() {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

/** The short-lived, signed cookie that carries state, nonce and the PKCE verifier across the redirect. */
export function packState(secret: string, data: { state: string; nonce: string; verifier: string; next: string; exp: number }) {
  const body = Buffer.from(JSON.stringify(data)).toString('base64url');
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}
export function unpackState(secret: string, raw: string | undefined, nowMs: number) {
  if (!raw) return null;
  const [body, sig] = raw.split('.');
  if (!body || !sig) return null;
  const want = Buffer.from(createHmac('sha256', secret).update(body).digest('base64url')); const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  const d = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  return d.exp * 1000 >= nowMs ? d as { state: string; nonce: string; verifier: string; next: string; exp: number } : null;
}

export function authorizeUrl(cfg: ZohoConfig & { redirectUri: string }, p: { state: string; nonce: string; challenge: string }) {
  const u = new URL('/oauth/v2/auth', cfg.accountsUrl);
  u.search = new URLSearchParams({
    response_type: 'code', client_id: cfg.clientId!, scope: 'openid email profile', redirect_uri: cfg.redirectUri,
    state: p.state, nonce: p.nonce, code_challenge: p.challenge, code_challenge_method: 'S256', access_type: 'online',
  }).toString();
  return u.toString();
}

export interface ZohoDeps { fetch?: typeof fetch; now: () => Date }

/** Exchanges the code and verifies the ID token. Throws HttpError(401) on anything unexpected. */
export function createZohoSignIn(cfg: () => ZohoConfig, deps: ZohoDeps) {
  const f = deps.fetch ?? fetch;
  const jwks = new Map<string, { keys: Jwk[]; until: number }>();
  const reject = (why: string): never => { throw new HttpError(401, 'zoho_rejected', `Zoho sign-in could not be verified (${why})`); };
  const keyFor = async (server: string, kid: string) => {
    for (const fresh of [false, true]) {
      let c = jwks.get(server);
      if (fresh || !c || c.until < deps.now().getTime()) {
        const r = await f(new URL('/oauth/v2/keys', server).toString());
        if (!r.ok) reject('keys unavailable');
        c = { keys: ((await r.json()) as { keys: Jwk[] }).keys, until: deps.now().getTime() + 3600_000 };
        jwks.set(server, c);
      }
      const k = c.keys.find((x) => x.kid === kid);
      if (k) return k;
    }
    return null;
  };
  return async (input: { code: string; verifier: string; nonce: string; server?: string | null; redirectUri: string }): Promise<ZohoIdentity> => {
    const c = cfg();
    if (!c.clientId || !c.clientSecret) throw new HttpError(503, 'zoho_not_configured', 'Zoho sign-in is not configured');
    const server = input.server && isZohoAccountsHost(input.server) ? new URL(input.server).origin : new URL(c.accountsUrl).origin;
    const r = await f(new URL('/oauth/v2/token', server).toString(), {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', client_id: c.clientId, client_secret: c.clientSecret, redirect_uri: input.redirectUri, code: input.code, code_verifier: input.verifier }).toString(),
    });
    const tok = (await r.json().catch(() => ({}))) as { id_token?: string; error?: string };
    if (!r.ok || !tok.id_token) return reject(tok.error ?? 'token exchange failed');
    const parts = tok.id_token.split('.');
    if (parts.length !== 3) return reject('malformed');
    let header: any; let claims: any;
    try { header = b64json(parts[0]); claims = b64json(parts[1]); } catch { return reject('malformed'); }
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') return reject('algorithm');
    const jwk = await keyFor(server, header.kid);
    if (!jwk) return reject('unknown key');
    if (!verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(parts[2], 'base64url'))) return reject('signature');
    const nowS = Math.floor(deps.now().getTime() / 1000);
    if (claims.iss !== server) return reject('issuer');
    if (claims.aud !== c.clientId && !(Array.isArray(claims.aud) && claims.aud.includes(c.clientId))) return reject('audience');
    if (typeof claims.exp !== 'number' || claims.exp + 60 < nowS) return reject('expired');
    if (claims.nonce !== input.nonce) return reject('nonce');
    if (typeof claims.email !== 'string' || typeof claims.sub !== 'string') return reject('no email');
    return { email: claims.email.toLowerCase(), emailVerified: claims.email_verified === true || claims.email_verified === 'true', sub: claims.sub, name: typeof claims.name === 'string' ? claims.name : null };
  };
}
