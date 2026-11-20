# High-level design: growth (VAVP), referrals, paid privileges, journal

Status: approved direction, 20 Nov 2026. Low-level design: [LLD.md](./LLD.md). Build log:
[../build-progress.md](../build-progress.md). Platform-side changes: notification-service
`docs/design/v2-HLD.md` (help_me_outgrow now owns every product rule; the platform only delivers).

## 1. Goals

| Id | Outcome |
| --- | --- |
| G0 | help_me_outgrow's backend creates and changes enrolments through the platform's secret-key API and applies every limit itself |
| G1 | Accounts: Google and Zoho sign-in for users and admins; `/admin` with roles owner, editor, support, viewer; audit log |
| G2 | **VAVP** (value added, value provided): levels earned by tasks (L1: 9 ratings or 1 referral visit; L2: 1 referred sign-up or 10 referral visits; more levels configurable), verified automatically from stats; an achievement screen with an unlock animation; one VAVP pick per level |
| G3 | Referral links per user with tracking (visits from other devices, sign-ups) and social-post proofs approved by support (1 approved post = 1 referral) |
| G4 | VAVP1 extra daily notifications on a chosen topic; VAVP2 extra quotes on a chosen topic; VAVP3 a user-owned topic (private or public, 150 lines) |
| G5 | Paid privileges on a **separate page**: VAVP1/2/3 for money, with terms by buyer rank (first 10: 1 year, next 10: 6 months, next 50: 3 months, rest: 1 month); Razorpay (India: UPI, cards, netbanking, wallets) and Stripe (rest of the world); all prices, terms and ladders admin-configurable |
| G6 | Enough quotes: a schedule may not need more notes than the topic can give; in the last days every note says "Notifications are about to end, choose what's next — x days left" and links to a choice: loop, extend quotes, or a new course |
| G7 | Journal: calm, uncluttered, encrypted per user; reminders through the platform; optionally tied to quote notifications; export and delete-all for the user only; admins see counts and timestamps only |
| G8 | Chrome "possible spam" fix: platform gap and daily cap, branded titles, plain buttons, content check in admin, Android app wrapper (Trusted Web Activity) |
| G9 | Pricing, refund, terms and contact pages (needed for payment-gateway activation) |

## 2. Context

```
 browser (React PWA, sw.js → sw-core.js)                help_me_outgrow api (Express)                 notification-service
 ┌──────────────────────────────────┐   cookie   ┌──────────────────────────────────────────┐ secret  ┌────────────────────┐
 │ onboarding · my notes · growth   │──────────▶ │ auth (Google, Zoho) · enrolments proxy    │──key──▶ │ /v1/subscribers/:x │
 │ upgrade (paid) · journal · admin │            │ levels engine · referrals · entitlements  │         │ /v1/topics (content│
 │ device registration via SDK      │──token────────────────────────────────────────────────────▶   │  :write)           │
 └──────────────────────────────────┘            │ payments (Razorpay, Stripe, mock) · journal│        └────────────────────┘
                 ▲   Razorpay Checkout / Stripe  │ admin api · audit · MongoDB (memory in tests)│
                 └── hosted checkout ◀──────────▶└──────────────────────────────────────────┘◀── payment webhooks
```

## 3. Key decisions

1. **One source of limits: entitlements.** A person's effective limits per topic =
   base (account-age ladder, moved from the platform: 3 → 6 after 30 days → 12 after 90) + active entitlements
   (from levels, purchases, or admin grants), capped by the platform's `maxPerDay`. Quotes per enrolment =
   90 + VAVP2 entitlements, capped by the lines the topic has. Every entitlement has a source and an optional
   expiry; purchases expire by their term.
2. **Levels are data.** `levels: [{ level, mode: any|all, tasks: [{type, count}] }]`. Task types:
   `ratings` (from the platform's per-subscriber summary), `referral_visits`, `referral_signups`,
   `approved_posts` (count as referral visits too). Progress is recomputed on demand and by a 10-minute job;
   a reached level is recorded once and never taken back.
3. **One pick per level.** Each new level grants one choice among the VAVPs open at that level
   (`vavp.<id>.levels`). Picks never expire. VAVP1/VAVP2 amounts per level are configurable
   (default VAVP1 L1 +1, L2 +2, L3 +3; VAVP2 L1 +3, L2 +6, L3 +9); a topic's level bonus is the **largest**
   pick on it (configurable to "sum").
4. **Referral = a visit from someone else's device.** Every browser gets a random device id (localStorage).
   A visit counts when the link's owner has never used that device id; each device counts once per link.
   Sign-ups count when a new account is created on a browser that arrived through the link.
5. **Payments behind a provider interface** (`razorpay`, `stripe`, `mock`). Country: `cf-ipcountry` or
   `x-country` header if a CDN provides it, else the browser's timezone (`Asia/Kolkata`/`Asia/Calcutta` → IN).
   IN → Razorpay in INR; others → Stripe in USD (prices configurable). Orders are created server-side;
   fulfilment happens only after a verified signature (Razorpay) or a verified webhook (both); idempotent by
   order id. Built and tested with test keys and the mock provider; live keys are owner inputs.
6. **Paid and earned are separate pages.** `/growth` shows levels, tasks, referral link and picks. `/upgrade`
   shows purchases only. Neither links the other's actions inline (a single quiet link at the bottom).
7. **Journal encryption.** AES-256-GCM; per-user key = HKDF(`JOURNAL_KEY`, user id). Text and mood are
   encrypted; only timestamps and counts are plain (that is all admins can see). Export (JSON/Markdown) and
   delete-all exist only in the user's session.
8. **Journal reminders** are enrolments on one private tenant topic `journal-prompts` (repeating prompts)
   with buttons "Write now" (open) and "Later" (snooze 30 min). "Tie to my quotes" instead sets the
   "Journal on this" button on that topic's quote enrolment, so no extra notification is sent.
9. **Spam-warning fix** (see platform v2): gap 15 min and 24 a day (platform), title "<topic> · help me
   outgrow", buttons "Helpful / Not for me", an admin content check that flags scam-like wording, and a
   Trusted Web Activity wrapper for Android (notifications then come from an installed app, outside both
   Chrome mechanisms).

## 4. Pricing defaults (all editable in admin)

| Product | Default |
| --- | --- |
| VAVP1 extra daily notification on one topic | 1st +1: ₹10 · 2nd: ₹50 · 3rd: ₹100 · bundle of 3: ₹109 |
| VAVP2 extra quotes on one topic | +3: ₹10 · +20: ₹50 |
| VAVP3 own topic, private | ₹50 for buyers 1–10, +₹10 per 10 buyers; after the last band (200) the last price stays |
| VAVP3 own topic, public | ₹100, +₹10 per 10 buyers, same rule |
| Term by buyer rank (per product) | 1–10: 12 months · 11–20: 6 · 21–70: 3 · 71+: 1 |
| International (Stripe, USD) | VAVP1 $0.99 / $2.99 bundle · VAVP2 $0.99 / $2.99 · VAVP3 $4.99 private, $7.99 public |

Renewal reminder: 3 days before a paid term ends (in-app banner and a line in the next notification).

## 5. Components

| Component | Responsibility |
| --- | --- |
| `api/src/store.ts` | collections, Mongo and in-memory implementations |
| `api/src/auth/*` | Google, Zoho (OIDC code + PKCE), sessions, admin roles |
| `api/src/platform.ts` | typed client for the platform's secret-key API |
| `api/src/limits.ts` | base ladder + entitlements → effective limits; content-sufficiency check |
| `api/src/enrolments.ts` | create/change/choose-next, ending notice, journal tie |
| `api/src/growth.ts` | levels config, progress, unlocks, picks |
| `api/src/referrals.ts` | codes, visits, sign-ups, proofs |
| `api/src/payments/*` | catalogue, pricing, provider adapters, orders, webhooks, fulfilment |
| `api/src/journal.ts` | encrypted entries, export, delete, reminder enrolment, stats |
| `api/src/admin.ts` | admin routes, audit |
| `client/src/pages/*` | Growth, Upgrade, Journal, Next (choice), Admin screens, legal pages |

## 6. Security and privacy

- Session cookies unchanged (HttpOnly, SameSite=Lax, origin check on writes). Admin routes check role per
  route and append to the audit log.
- Payment amounts are computed on the server; the client never sends a price. Webhook signatures are
  verified with constant-time comparison; replays are no-ops.
- Journal plaintext never reaches logs, the admin api, or the platform.
- Referral endpoints are rate-limited per IP and device; device ids are random and carry no identity.

## 7. Build order

G0 (with platform P1–P4) → G8 platform part (P5–P6) → G1 → G2+G3 → G4 → G6 → G5 → G7 → G8 app part, G9.
Each step: tests (vitest api, Playwright e2e against the full local stack), progress log, push.
