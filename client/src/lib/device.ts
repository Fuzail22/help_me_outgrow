/** A random id for this browser (not a fingerprint): referral visits from your own devices never count. */
const KEY = 'hmo_device'; const REF = 'hmo_ref'; const REF_DAYS = 30;
const random = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
export function deviceId(): string {
  try { let id = localStorage.getItem(KEY); if (!id) { id = random(); localStorage.setItem(KEY, id); } return id; } catch { return random(); }
}
/** The referral code this browser arrived with, kept for 30 days so a later sign-up still counts. */
export function rememberRef(code: string) { try { localStorage.setItem(REF, JSON.stringify({ code, at: Date.now() })); } catch { /* private mode */ } }
export function currentRef(): string | null {
  try { const r = JSON.parse(localStorage.getItem(REF) ?? 'null'); return r && Date.now() - r.at < REF_DAYS * 86400000 ? r.code : null; } catch { return null; }
}
export const arrival = () => ({ deviceId: deviceId(), ref: currentRef() });
