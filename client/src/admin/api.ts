import { api } from '../lib/ns';
/** Admin calls: same session cookie; writes carry x-admin (a second CSRF guard the server checks). */
const API = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
export async function admin<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (method === 'GET') return api<T>('GET', `/api/admin${path}`);
  const res = await fetch(`${API}/api/admin${path}`, { method, credentials: API ? 'include' : 'same-origin', headers: { 'x-admin': '1', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (res.status === 204) return null as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error?.message ?? 'Request failed'), { status: res.status, code: data.error?.code, details: data.error?.details });
  return data as T;
}
export type Role = 'owner' | 'editor' | 'support' | 'viewer';
export const RANK: Record<Role, number> = { viewer: 1, support: 2, editor: 3, owner: 4 };
export const can = (me: { role: Role }, min: Role) => RANK[me.role] >= RANK[min];
export const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
export const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;
export const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—');
