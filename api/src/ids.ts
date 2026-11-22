import { randomBytes } from 'node:crypto';
/** Time-sortable random ids: 10 hex chars of milliseconds + 12 random. */
export const newId = (prefix = '') => prefix + Date.now().toString(16).padStart(11, '0') + randomBytes(6).toString('hex');
/** 8 characters from an alphabet without look-alikes (no 0/O, 1/l/I). */
export function referralCode() {
  const A = 'abcdefghjkmnpqrstuvwxyz23456789';
  return [...randomBytes(8)].map((b) => A[b % A.length]).join('');
}
