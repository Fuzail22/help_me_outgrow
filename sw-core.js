/*
 * Service-worker core for the notification platform.
 *
 * A push subscription belongs to the origin that registered the worker, so
 * this file must be served from the tenant's own site. The tenant's sw.js is
 * one line:   importScripts('/sw-core.js');
 * The SDK registers it as /sw.js?api=<platform API>&key=<publishable key>.
 */
(() => {
  const params = new URL(self.location.href).searchParams;
  const API = params.get('api');
  const KEY = params.get('key');

  // text/plain keeps the request "simple", so no CORS preflight delays the worker.
  const send = (api, path, body, token) =>
    fetch(`${api}${path}${token ? `?token=${encodeURIComponent(token)}` : `?key=${encodeURIComponent(KEY || '')}`}`, {
      method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify(body), keepalive: true,
    });
  const post = (api, path, body, token) => send(api, path, body, token).catch(() => undefined);
  /** Resolves to true only for a 2xx answer; never throws. */
  const postOk = (api, path, body, token) => send(api, path, body, token).then((r) => !!(r && r.ok), () => false);
  const report = (data, type) => post(data.api, '/v1/events', { events: [{ type, ts: new Date().toISOString() }] }, data.token);

  // The last known push endpoint, kept so a rotation can be reported even when the browser does not say what the old one was.
  const META = 'ns-meta-v1';
  const remember = async (endpoint) => { try { await (await caches.open(META)).put('/__ns/endpoint', new Response(endpoint)); } catch { /* storage unavailable */ } };
  const recall = async () => { try { const r = await (await caches.open(META)).match('/__ns/endpoint'); return r ? r.text() : null; } catch { return null; } };
  const rememberCurrent = async () => { const s = await self.registration.pushManager.getSubscription().catch(() => null); if (s) await remember(s.endpoint); };

  self.addEventListener('install', () => self.skipWaiting());
  self.addEventListener('activate', (event) => event.waitUntil(Promise.all([self.clients.claim(), rememberCurrent()])));

  self.addEventListener('push', (event) => {
    let data = null;
    try { data = event.data.json(); } catch { /* not ours, or empty */ }
    // waitUntil keeps the worker alive until the notification is on screen.
    event.waitUntil((async () => {
      if (!data || data.v !== 1) {
        // Browsers penalise a push that shows nothing, so always show something.
        return self.registration.showNotification('You have a new note', { data: { url: self.registration.scope } });
      }
      await self.registration.showNotification(data.title, {
        body: data.body, icon: data.icon || undefined, badge: data.icon || undefined, image: data.image || undefined,
        tag: data.deliveryId, actions: data.actions || [],
        data: { url: data.url, deliveryId: data.deliveryId, token: data.token, api: data.api, icon: data.icon || null },
      });
      await Promise.all([report(data, 'shown'), rememberCurrent()]);
    })());
  });

  /** How long the "Thanks, noted" confirmation stays before the worker closes it (where the browser allows). */
  const THANKS_MS = 3000;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // A rating from an action button records the rating and opens nothing. Only a 2xx answer earns a "Thanks";
  // a failed request shows nothing and is not retried.
  const rate = async (data, value) => {
    const ok = await postOk(data.api, '/v1/feedback', { deliveryId: data.deliveryId, rating: value, source: 'notification' }, data.token);
    if (!ok) return;
    const tag = data.deliveryId;
    await self.registration.showNotification('Thanks, noted', { tag, body: '', icon: data.icon || undefined, badge: data.icon || undefined, silent: true, renotify: false, actions: [], data: { thanks: true, deliveryId: tag } });
    await wait(THANKS_MS);
    const left = await self.registration.getNotifications({ tag }).catch(() => []);
    for (const n of left) if (n.data && n.data.thanks) n.close();
  };

  self.addEventListener('notificationclick', (event) => {
    const data = event.notification.data || {};
    event.notification.close();
    if (data.thanks) return; // tapping the confirmation does nothing
    if (data.token && (event.action === 'up' || event.action === 'down')) {
      event.waitUntil(rate(data, event.action));
      return;
    }
    event.waitUntil((async () => {
      const work = [];
      if (data.token) work.push(report(data, 'clicked'));
      // A tap on the body opens the quote page. A tab already showing it is focused;
      // other open tabs are left as they are (someone may be half-way through a form).
      const open = (async () => {
        if (!data.url) return;
        const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        const same = tabs.find((c) => c.url === data.url);
        if (same) { try { return void (await same.focus()); } catch { /* fall through */ } }
        await self.clients.openWindow(data.url);
      })();
      await Promise.all([...work, open]);
    })());
  });

  // Chromium only.
  self.addEventListener('notificationclose', (event) => {
    const data = event.notification.data || {};
    if (data.token) event.waitUntil(report(data, 'closed'));
  });

  // The browser replaced the subscription: tell the platform, or sends would start failing with 410.
  self.addEventListener('pushsubscriptionchange', (event) => {
    event.waitUntil((async () => {
      if (!API || !KEY) return;
      // Chromium usually gives no oldSubscription; fall back to the endpoint remembered at the last push.
      const oldEndpoint = (event.oldSubscription && event.oldSubscription.endpoint) || await recall();
      let next = event.newSubscription || await self.registration.pushManager.getSubscription();
      if (!next) {
        let options = event.oldSubscription && event.oldSubscription.options;
        if (!options) {
          const cfg = await fetch(`${API}/v1/config?key=${encodeURIComponent(KEY)}`).then((r) => r.json());
          const pad = '='.repeat((4 - (cfg.vapidPublicKey.length % 4)) % 4);
          const raw = atob((cfg.vapidPublicKey + pad).replace(/-/g, '+').replace(/_/g, '/'));
          options = { userVisibleOnly: true, applicationServerKey: Uint8Array.from(raw, (c) => c.charCodeAt(0)) };
        }
        next = await self.registration.pushManager.subscribe(options);
      }
      if (!oldEndpoint || !next || oldEndpoint === next.endpoint) return;
      const json = next.toJSON();
      await post(API, '/v1/devices:rotate', { oldEndpoint, endpoint: json.endpoint, keys: json.keys });
      await remember(next.endpoint);
    })());
  });
})();
