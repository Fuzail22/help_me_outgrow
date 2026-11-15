import { createClient } from '@notification-service/sdk';

export interface User { id: string; name: string; email: string }

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, { method, credentials: 'same-origin', headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 204) return null as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error?.message ?? 'Request failed'), { status: res.status, code: data.error?.code });
  return data as T;
}

let cached: { token: string; until: number } | null = null;
export const clearToken = () => { cached = null; };
/** A short-lived platform token from our own backend; refreshed a minute before it expires. */
async function getToken() {
  if (cached && Date.now() < cached.until) return cached.token;
  const r = await api<{ token: string; expiresIn: number }>('POST', '/auth/platform-token');
  cached = { token: r.token, until: Date.now() + (r.expiresIn - 60) * 1000 };
  return r.token;
}

export const ns = createClient({ apiBase: import.meta.env.VITE_PLATFORM_API_URL, publishableKey: import.meta.env.VITE_PUBLISHABLE_KEY, getToken });

export const auth = {
  me: () => api<{ user: User }>('GET', '/auth/me').then((r) => r.user).catch(() => null),
  google: (credential: string) => api<{ user: User }>('POST', '/auth/google', { credential }).then((r) => { clearToken(); return r.user; }),
  dev: (name: string) => api<{ user: User }>('POST', '/auth/dev', { name }).then((r) => { clearToken(); return r.user; }),
  logout: () => api<null>('POST', '/auth/logout').then(clearToken),
  deleteAccount: () => api<null>('DELETE', '/auth/me').then(clearToken),
};

export const HELPLINE_URL = import.meta.env.VITE_HELPLINE_URL ?? 'https://findahelpline.com/';
export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
export const DEV_LOGIN = import.meta.env.VITE_DEV_LOGIN === '1';
