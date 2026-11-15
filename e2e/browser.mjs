/**
 * Browser helpers for end-to-end runs.
 *
 * Real browsers get their push subscription from the vendor's push service
 * (FCM for Chrome). That network is not reachable from CI sandboxes, so here
 * `pushManager.subscribe()` is answered by the local push-service stand-in,
 * and each push the platform sends to it is handed to the page's real service
 * worker through the DevTools protocol. Everything else is the real thing:
 * the SDK, the service worker, the platform's VAPID signing and encryption.
 */
export async function wirePush(context, page, stack) {
  await context.grantPermissions(['notifications']);
  const mine = new Set();
  await context.exposeBinding('__pushRegister', () => { const s = stack.push.register(); mine.add(s.id); return { id: s.id, endpoint: s.endpoint, keys: s.keys }; });
  await context.addInitScript(() => {
    const KEY = '__fakePushSub';
    const wrap = (raw, options) => raw && ({
      endpoint: raw.endpoint, expirationTime: null, options: options ?? { userVisibleOnly: true, applicationServerKey: null },
      toJSON: () => ({ endpoint: raw.endpoint, expirationTime: null, keys: raw.keys }),
      unsubscribe: async () => { localStorage.removeItem(KEY); return true; },
    });
    if (!('PushManager' in window)) return;
    PushManager.prototype.subscribe = async function (options) {
      const raw = await window.__pushRegister(); localStorage.setItem(KEY, JSON.stringify(raw)); return wrap(raw, options);
    };
    PushManager.prototype.getSubscription = async function () { return wrap(JSON.parse(localStorage.getItem(KEY) ?? 'null')); };
  });
  const cdp = await context.newCDPSession(page);
  let registrationId = null;
  cdp.on('ServiceWorker.workerRegistrationUpdated', (e) => { for (const r of e.registrations) if (!r.isDeleted) registrationId = r.registrationId; });
  await cdp.send('ServiceWorker.enable');
  return {
    /** Hand every push the stand-in has received for this browser since the last call to its service worker. */
    async deliverPending(origin) {
      const msgs = stack.push.messages.filter((m) => mine.has(m.id));
      for (const m of msgs) stack.push.messages.splice(stack.push.messages.indexOf(m), 1);
      for (const m of msgs) await cdp.send('ServiceWorker.deliverPushMessage', { origin, registrationId, data: m.payload });
      return msgs;
    },
  };
}

export const serviceWorker = async (context) => context.serviceWorkers()[0] ?? context.waitForEvent('serviceworker');
/** Notifications currently shown by the service worker. */
export const shownNotifications = async (context) => (await serviceWorker(context)).evaluate(async () =>
  (await self.registration.getNotifications()).map((n) => ({ title: n.title, body: n.body, tag: n.tag, data: n.data, actions: (n.actions ?? []).map((a) => a.action) })));
/** Tap a notification (optionally one of its action buttons), as the OS would report it to the worker. */
export const tapNotification = async (context, tag, action = '') => (await serviceWorker(context)).evaluate(async ({ tag, action }) => {
  const [n] = await self.registration.getNotifications({ tag });
  self.dispatchEvent(new NotificationEvent('notificationclick', { notification: n, action }));
  return n.data.url;
}, { tag, action });
