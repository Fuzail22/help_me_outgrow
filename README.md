# help_me_outgrow

A short, supportive note in your browser's notifications at the times you choose. No app to install.
Version 0.6: four curated topics, Google and Zoho sign-in, levels earned by helping the app grow (VAVP), paid
privileges (Razorpay: UPI and cards in India, international cards in USD), a private journal, and an admin at `/admin`.
Design: [docs/design/HLD.md](docs/design/HLD.md), [LLD.md](docs/design/LLD.md); build log: [docs/build-progress.md](docs/build-progress.md).
iPhone (iOS 16.4+) works as a Home Screen web app; the owner's real-device checklist is [docs/iphone-test.md](docs/iphone-test.md).

This repository is a tenant of the [notification-service](../notification-service) platform. It talks to it
only through the published SDK and the v1 API; there is no shared database and no shared code. Every product rule
(who may follow which topic, how many times a day, for how long, at what price) lives here: the backend creates and
changes enrolments with the platform's secret key (`/v1/accounts/:userId/…`), and the platform only enforces its own
delivery policy (24 notifications a day per person, 15 minutes apart, 366 days at most).

| Feature | Where |
| --- | --- |
| Levels (VAVP): tasks checked from numbers, celebration, one pick per level | `/growth`, `api/src/growth.ts` |
| Referral links (`/r/<code>`), social-post proofs reviewed by support | `/growth`, admin → Social posts |
| VAVP1 more notifications a day, VAVP2 more notes, VAVP3 own topic | `/growth`, `/upgrade`, `/my-topic` |
| Enough notes for the schedule; "about to end, choose what's next" | onboarding, `/next/:id` |
| Paid privileges, separate page; terms by buyer number | `/upgrade`, `api/src/payments/*` |
| Journal (encrypted per person), reminders, export and delete | `/journal`, `api/src/journal.ts` |
| Admin: settings with explanations, people, topics, orders, journal counts, admins, audit | `/admin` |
| Android app wrapper to keep notes out of Chrome's spam checks | `android/README.md` |

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
cd e2e && npm test          # browser tests (5 on an emulated iPhone); uses the globally installed Playwright
cd e2e && npm run demo      # records e2e/demo-output/first-cut-demo.mp4
cd e2e && npm run demo:r1   # records e2e/demo-output/r1-feedback-demo.mp4 (rating from the notification)
cd e2e && npm run demo:iphone # records e2e/demo-output/r5-iphone-demo.mp4 (emulated iPhone)
```

## Going live (things only the owner can do)

New in 0.6 (in this order):

- Platform: bootstrap the tenant with `--privileged` (or run `npm run keys -- --tenant hmo --grant content:write`)
  so this app can manage topics and lines.
- In the platform console, set the policy title to `{topic} · help me outgrow`. Turn **Browser enrolments** off
  once this version is deployed.
- Set `JOURNAL_KEY` (`openssl rand -hex 32`) and never change it.
- Set `ADMIN_OWNER_EMAIL`.
- Optional: Zoho client, Razorpay and Stripe keys, with webhooks at `API_URL/api/payments/webhook/razorpay` and `…/stripe`.
- Review the pricing, refunds, terms and privacy pages (see the "Before merge" checklist in the pull request template).

1. Register the permanent domain first. Subscriptions are bound to the origin and cannot be moved.
2. Deploy notification-service; run its `bootstrap` with `--origin https://<domain>` and
   `--click-url "https://<domain>/n/{deliveryId}?t={token}"`; keep the keys.
3. `PLATFORM_API_URL=… PLATFORM_SECRET_KEY=sk_… node content/seed.mjs`
4. Create a Google OAuth web client (authorised JavaScript origin = the app domain); publish the consent screen.
5. Put every setting in the GitHub `production` environment (table below), then run *Deploy api*: it
   copies the api's settings to Fly and deploys. Do not use `fly secrets set` by hand; the next deploy overwrites it.
6. Push `client/` to `main` (or run *Deploy client*): it builds with the same environment's variables.

### Releases are automatic

A merge to `main` deploys what it changed, after CI passes on that commit:
`api/**` → *Deploy api* (settings sync, `flyctl deploy`, then `API_URL/auth/healthz` must answer);
`client/**` → *Deploy client* (build, publish to Pages, then the live page must reference the new build).
Changes to the CI or deploy workflows or `.github/scripts/` release both. One deploy of each runs at a time,
in merge order. Both can also be started by hand. To require an approval before each release, add required
reviewers to the `production` environment.

### Settings: one place, the GitHub `production` environment

Both deploy workflows read the same environment, so a value shared by the api and the app is entered once.
`api/fly.toml` keeps only `PORT` and `NODE_ENV`, which are constants of the image.

| Name | Kind | Used by | Notes |
| --- | --- | --- | --- |
| `FLY_API_TOKEN` | secret | api deploy | |
| `SESSION_SECRET` | secret | api | `openssl rand -hex 32`; changing it signs everyone out |
| `PLATFORM_SECRET_KEY` | secret | api | `sk_…` from the platform's bootstrap |
| `MONGO_URI` | secret | api | required: without it the api would keep users in a file that Fly discards |
| `APP_DOMAIN` | variable | api, app | e.g. `outgrow.htsta.com`; the api's `APP_ORIGIN` is `https://` + this, and it is the Pages domain |
| `API_URL` | variable | app | the api's address, e.g. `https://api.outgrow.htsta.com` |
| `PLATFORM_API_URL` | variable | api, app | `https://notification.htsta.com` |
| `PUBLISHABLE_KEY` | variable | app | `pk_…` from the bootstrap (public by design) |
| `GOOGLE_CLIENT_ID` | variable | api, app | the OAuth web client (public by design) |
| `HELPLINE_URL` | variable | app | optional; defaults to https://findahelpline.com/ |
| `JOURNAL_KEY` | secret | api | required; 64 hex chars; protected (the deploy refuses to change it) |
| `ADMIN_OWNER_EMAIL` | variable | api | first owner of `/admin` |
| `SUPPORT_EMAIL` | variable | api | defaults to support@htsta.com |
| `ZOHO_CLIENT_ID` / `ZOHO_CLIENT_SECRET` / `ZOHO_ACCOUNTS_URL` | variable / secret / variable | api | optional Zoho sign-in; redirect URI `API_URL/auth/zoho/callback` |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET` | variable / secret / secret | api | India payments |
| `RAZORPAY_INTERNATIONAL` | variable | api | `1` once Razorpay's International payments is activated: visitors abroad pay in USD through Razorpay |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | secret / secret | api | optional; only if Stripe ever becomes available to you |

## Content

`content/topics/*.csv` are original lines written for this project as a first draft. They have not been
reviewed by anyone qualified in mental-health support; review "Loss" and "Low mood" before public launch.
The helpline link (`VITE_HELPLINE_URL`) and the privacy page are also drafts to review.
