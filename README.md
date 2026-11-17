# help_me_outgrow

A short, supportive note in your browser's notifications at the times you choose. No app to install.
Version 0.5.0 (first cut): four curated topics, text notes, Android and desktop browsers, Google sign-in.

This repository is a tenant of the [notification-service](../notification-service) platform. It talks to it
only through the published SDK and the v1 API; there is no shared database and no shared code.

```
client/    React web app (landing, onboarding, My notes, quote page, privacy); installable PWA
api/       thin backend: Google sign-in, session cookie, token exchange with the platform
content/   the four topics as CSV (92 lines each) and seed.mjs, which loads them through the platform API
e2e/       browser tests and the demo recording; starts the whole stack on localhost
```

## Run everything locally

Needs a checkout of `notification-service` beside this one (or set `NS_REPO`), with `npm ci` run in its `server/`.

```bash
(cd api && npm ci) && (cd client && npm ci)
node e2e/stack.mjs          # platform :8080, api :8787, app http://localhost:5173, dev login, throwaway keys
cd e2e && npm test          # 13 browser tests
cd e2e && npm run demo      # records e2e/demo-output/first-cut-demo.mp4
cd e2e && npm run demo:r1   # records e2e/demo-output/r1-feedback-demo.mp4 (rating from the notification)
```

## Going live (things only the owner can do)

1. Register the permanent domain first. Subscriptions are bound to the origin and cannot be moved.
2. Deploy notification-service; run its `bootstrap` with `--origin https://<domain>` and
   `--click-url "https://<domain>/n/{deliveryId}?t={token}"`; keep the keys.
3. `PLATFORM_API_URL=… PLATFORM_SECRET_KEY=sk_… node content/seed.mjs`
4. Create a Google OAuth web client (authorised JavaScript origin = the app domain); publish the consent screen.
5. Deploy `api/` with `api/.env.example` filled in, reachable at `https://<domain>/auth/*` (same origin as the app,
   so the session cookie is first-party).
6. Set the repository variables used by `.github/workflows/deployClient.yml` and push `client/` to `main`.

## Content

`content/topics/*.csv` are original lines written for this project as a first draft. They have not been
reviewed by anyone qualified in mental-health support; review "Loss" and "Low mood" before public launch.
The helpline link (`VITE_HELPLINE_URL`) and the privacy page are also drafts to review.
