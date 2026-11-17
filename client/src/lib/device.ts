import { ns } from './ns';

/**
 * Keeps this browser connected for push (R5 item 5).
 *
 * A subscription can disappear while the notification permission is still granted (iOS and Safari drop
 * it after storage is cleared or the Home Screen app is reinstalled; other browsers do it now and then).
 * Then the app subscribes again silently: the permission is already granted, so no prompt opens. Only
 * when the permission is gone does the person need to act, and the app shows one banner for that.
 */
export type Connection = 'connected' | 'reconnected' | 'off' | 'not_applicable';

const OFF_KEY = 'hmo_device_off';
/** The person chose "Stop notes on this device": never undo that silently. */
export function setDeviceTurnedOff(off: boolean) {
  try { if (off) localStorage.setItem(OFF_KEY, '1'); else localStorage.removeItem(OFF_KEY); } catch { /* storage blocked: nothing to remember */ }
  pending = null;
}
const turnedOff = () => { try { return localStorage.getItem(OFF_KEY) === '1'; } catch { return false; } };

let pending: Promise<Connection> | null = null;
/** Checks once per page load (signed-in only) and reconnects silently where it can. */
export function ensureConnected(): Promise<Connection> {
  return (pending ??= (async (): Promise<Connection> => {
    if (!ns.detectSupport().supported || turnedOff()) return 'not_applicable';
    if (await ns.currentSubscription().catch(() => null)) return 'connected';
    if (ns.permission() !== 'granted') return 'off';
    const r = await ns.subscribe().catch(() => null);
    // The platform records `resubscribed` itself when this replaces an expired device.
    return r?.status === 'subscribed' ? 'reconnected' : 'off';
  })());
}
export const forgetConnection = () => { pending = null; };
