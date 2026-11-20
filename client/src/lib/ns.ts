import { createClient, type Slot } from '@notification-service/sdk';
import { arrival } from './device';

export interface User { id: string; name: string; email: string; referralCode?: string }

// Empty in local development (a dev proxy serves /auth on the same origin); the api's own address in production.
const API = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

export class AppError extends Error { status = 0; code = 'error'; details?: any }
export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(API + path, { method, credentials: API ? 'include' : 'same-origin', headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 204) return null as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new AppError(data.error?.message ?? 'Request failed'), { status: res.status, code: data.error?.code, details: data.error?.details });
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
  config: () => api<{ google: boolean; zoho: boolean; dev: boolean }>('GET', '/auth/config'),
  google: (credential: string) => api<{ user: User }>('POST', '/auth/google', { credential, ...arrival() }).then((r) => { clearToken(); return r.user; }),
  dev: (name: string) => api<{ user: User }>('POST', '/auth/dev', { name, ...arrival() }).then((r) => { clearToken(); return r.user; }),
  /** Zoho signs in by redirecting away and back; the api sets the session and returns to `next`. */
  zohoUrl: (next: string) => `${API}/auth/zoho/start?next=${encodeURIComponent(next)}&deviceId=${encodeURIComponent(arrival().deviceId)}${arrival().ref ? `&ref=${arrival().ref}` : ''}`,
  logout: () => api<null>('POST', '/auth/logout').then(clearToken),
  deleteAccount: () => api<null>('DELETE', '/auth/me').then(clearToken),
};

export const HELPLINE_URL = import.meta.env.VITE_HELPLINE_URL ?? 'https://findahelpline.com/';
export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
export const DEV_LOGIN = import.meta.env.VITE_DEV_LOGIN === '1';

// ---- this app's own api: product rules live here, the platform only delivers
export interface TopicLimits { maxSlots: number; maxItems: number; itemsAvailable: number; parts: { base: number; levelSlots: number; paidSlots: number; baseItems: number; levelItems: number; paidItems: number } }
export interface AppTopic { id: string; slug: string; title: string; description: string; sensitive: boolean; itemCount: number; repeat: boolean }
export interface Limits { perTopic: Record<string, TopicLimits>; maxDurationDays: number; durations: { days: number; label: string }[]; platform: { maxPerDay: number; minGapMinutes: number }; topics: AppTopic[] }
export interface AppEnrolment {
  id: string; topicId: string; topicTitle?: string; slots: Slot[]; timezone: string; startDate: string; endDate: string; position: number; nextSendAt: string | null;
  status: 'active' | 'paused' | 'completed' | 'cancelled'; maxItems: number | null; sentCount: number; loop: boolean | null; itemsAvailable: number;
}
export interface PublicConfig { baseItems: number; baseSlots: number; maxDurationDays: number; durations: { days: number; label: string }[] }
export type EnrolmentPatch = { action?: 'pause' | 'resume' | 'cancel'; slots?: Slot[]; endDate?: string; reason?: string };
export const app = {
  publicConfig: () => api<PublicConfig>('GET', '/api/public/config'),
  limits: () => api<Limits>('GET', '/api/me/limits'),
  enrolments: () => api<{ enrolments: AppEnrolment[] }>('GET', '/api/enrolments').then((r) => r.enrolments),
  createEnrolment: (b: { topicId: string; slots: Slot[]; timezone: string; endDate: string; startDate?: string; loop?: boolean }) => api<AppEnrolment>('POST', '/api/enrolments', b),
  updateEnrolment: (id: string, patch: EnrolmentPatch) => api<AppEnrolment>('PATCH', `/api/enrolments/${encodeURIComponent(id)}`, patch),
  next: (id: string, b: { choice: 'loop' | 'extend' | 'new'; topicId?: string; days?: number }) => api<AppEnrolment>('POST', `/api/enrolments/${encodeURIComponent(id)}/next`, b),
};
