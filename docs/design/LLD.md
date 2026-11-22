# Low-level design: growth (VAVP), referrals, paid privileges, journal

Companion to [HLD.md](./HLD.md). Step ids (G0…G9) are used in `../build-progress.md`.

## Data (api, MongoDB; in-memory store in tests and local runs)

```ts
User         { id; email; name; createdAt; providers: { google?: sub; zoho?: sub }; deviceIds: string[];
               referralCode: string /* 8 chars, unique */; referredBy?: { code; userId; deviceId; at } }
AdminUser    { email /* lower-case */; role: 'owner'|'editor'|'support'|'viewer'; invitedBy; createdAt }
Audit        { id; actor; action; target; before; after; ts }
Settings     { _id: 'growth' | 'pricing' | 'limits'; data; updatedAt; updatedBy }   // admin-editable config
RefVisit     { id; code; ownerId; deviceId; ipHash; at }                 unique (code, deviceId)
RefProof     { id; userId; note; status: 'pending'|'approved'|'rejected'; decidedBy; decidedAt; createdAt }
LevelUnlock  { userId; level; at; pick?: { vavp: 'vavp1'|'vavp2'|'vavp3'; topicId; amount; at } } unique (userId, level)
Entitlement  { id; userId; kind: 'slots'|'items'|'own_topic'; topicId|null; amount; source: 'level'|'purchase'|'admin';
               sourceRef; startsAt; expiresAt|null; revokedAt|null }
Order        { id; userId; product; topicId|null; units; amountMinor; currency; provider; providerOrderId;
               status: 'created'|'paid'|'failed'|'refunded'; rank; termMonths; createdAt; paidAt }
Sale counter { product; count }   // buyer rank per product, incremented atomically when an order is paid
OwnTopic     { userId; platformTopicId; visibility: 'private'|'public'; status: 'draft'|'review'|'live'; lineCap: 150 }
JournalEntry { id; userId; ts; iv; ct /* AES-GCM of {text, mood, quote?} */; tag; hasQuote: boolean }
Waitlist     { email; country; at }
```

## G0. Enrolments through the backend

`api/src/platform.ts` wraps the platform: `subscriber(externalId)`, `createEnrolment(externalId, body)`,
`patchEnrolment(externalId, id, body)`, `summary(externalId)`, topic/line content calls.

Routes (session required):

| Route | Behaviour |
| --- | --- |
| `GET /api/me/limits` | `{ maxDurationDays, perTopic: { [topicId]: { maxSlots, maxItems, itemsAvailable } }, platform: { maxPerDay, minGapMinutes } }` |
| `GET /api/enrolments` | platform list, plus the person's limits per topic |
| `POST /api/enrolments` | validate against limits (`too_many_slots`, `invalid_duration`, `not_enough_quotes` with options), set `maxItems`, `endingNotice`, `actions`, then create on the platform |
| `PATCH /api/enrolments/:id` | slots/endDate/pause/resume/cancel, same checks |
| `POST /api/enrolments/:id/next` | `{ choice: 'loop' | 'extend' | 'new', topicId? }` (G6) |

Limits: `maxSlots = ladder(ageDays) + levelBonus(topic) + paidSlots(topic)` capped at platform `maxPerDay`;
`maxItems = 90 + levelItems(topic) + paidItems(topic)`; `maxDurationDays = settings.limits.maxDurationDays (92)`.
The client uses `/api/*` for create and change; the SDK still registers devices, completes the profile,
sends ratings and events. `browserEnrolments` is switched off for this tenant after deploy (owner step).

## G1. Accounts and admin

- Google: unchanged (ID token from Google Identity Services).
- Zoho: `GET /auth/zoho/start?next=` → state+nonce+PKCE verifier in a short signed cookie → Zoho authorize URL
  (`ZOHO_ACCOUNTS_URL`, default `https://accounts.zoho.in`); `GET /auth/zoho/callback` → token exchange with
  `ZOHO_CLIENT_ID/SECRET` → verify ID token (RS256 via JWKS `…/oauth/v2/keys`, `iss`, `aud`, `nonce`, `exp`)
  → upsert user by `providers.zoho`, or link to an existing user with the same verified email → session → redirect.
- Admin: `ADMIN_OWNER_EMAIL` is owner at first sign-in; owners invite others by email and role.
  Role rank owner > editor > support > viewer. `GET /admin/api/me`. Writes need header `x-admin: 1`.

| Admin route | Min role |
| --- | --- |
| `GET /admin/api/overview` (users, levels reached, referrals, revenue, journal counts) | viewer |
| `GET/PUT /admin/api/settings/:id` (growth, pricing, limits) | editor (pricing: owner) |
| `GET /admin/api/users?q=`, `GET /admin/api/users/:id` | support |
| `POST /admin/api/users/:id/entitlements`, `DELETE …/:entId` | owner |
| `GET /admin/api/proofs`, `POST /admin/api/proofs/:id/approve|reject` | support |
| `GET /admin/api/orders` | viewer |
| `GET/POST/PATCH /admin/api/topics…` (platform content API) + `POST /admin/api/content-check` | editor |
| `GET/POST/DELETE /admin/api/admins` | owner |
| `GET /admin/api/audit?before=` | owner |
| `GET /admin/api/journal-stats` (per day counts, active writers, entries with quotes) | viewer |

## G2. Levels

```json
{ "levels": [
  { "level": 1, "mode": "any", "tasks": [{ "type": "ratings", "count": 9 }, { "type": "referral_visits", "count": 1 }] },
  { "level": 2, "mode": "any", "tasks": [{ "type": "referral_signups", "count": 1 }, { "type": "referral_visits", "count": 10 }] } ],
  "vavp": { "vavp1": { "levels": { "1": 1, "2": 2, "3": 3 }, "stack": "max" },
            "vavp2": { "levels": { "1": 3, "2": 6, "3": 9 }, "stack": "max" },
            "vavp3": { "levels": {} } } }
```

`progress(user)`: counts — ratings from `platform.summary` (cached 5 min), referral visits = RefVisit count +
approved proofs, sign-ups = users with `referredBy.userId`. Levels unlock in order (L2 needs L1). New unlocks
are inserted (unique) and returned as `celebrate: [level]` once. `GET /api/growth` → `{ level, next: {level,
tasks:[{type,count,have}]}, unlocks, pendingPicks, referral: { url, visits, signups } }`.
`POST /api/growth/pick { level, vavp, topicId }` → validates the VAVP is open at that level and unpicked →
Entitlement (`source: 'level'`, no expiry).

Celebration (client): full-screen dialog, a padlock SVG whose shackle lifts (CSS transform, 600 ms; reduced
motion → fade), "Level N reached", what was done, then the pick cards (VAVP open at this level, with a topic
selector). Shown when `/api/growth` returns `celebrate`.

## G3. Referrals

- `GET /r/:code` (client route) → `POST /api/ref/visit { code, deviceId }` → counts when the code exists,
  the device id is not in the owner's `deviceIds`, and (code, deviceId) is new; rate limit 30/min per IP.
  Stores `hmo_ref` (code) in localStorage for 30 days, then redirects to `/`.
- Sign-in: the client sends `deviceId` and `ref` with every sign-in; the api records device ids on the
  user, and for a **new** account with a valid ref (not the same user) sets `referredBy`.
- Proof: `/growth` shows "Posted about us? Email a screenshot to support@htsta.com from <your email>" with a
  prefilled `mailto:` (subject contains the referral code) and "I've sent it" → `RefProof pending`.
  Support approves in admin → +1 referral visit.

## G4. VAVP1/2/3 effects

- VAVP1 (`slots`, per topic): raises `maxSlots` for that topic. Existing enrolment times are not added
  automatically; the "my notes" page offers "+ Add another time".
- VAVP2 (`items`, per topic): raises `maxItems`; live enrolments on that topic are patched on the platform
  (`maxItems`) immediately.
- VAVP3 (`own_topic`): creates a platform topic `u-<userId>-<n>` (private) via the content API; the user
  edits up to 150 lines in `/my-topic` (append and edit only, like all topics); "more lines" → mailto
  support. Public: status `review` until an editor approves in admin, then `visibility: public`.
  Expiry of a paid own topic: the topic stops taking new enrolments; existing ones finish.

## G5. Payments

Catalogue (from settings): `vavp1_unit` (price by the n-th active paid unit on that topic: [1000, 5000,
10000] paise), `vavp1_bundle3` (10900), `vavp2_3` (1000), `vavp2_20` (5000), `vavp3_private`,
`vavp3_public` (ladders: `start`, `step`, `band`, `maxBuyers`), `terms: [{upTo:10,months:12},{upTo:20,months:6},
{upTo:70,months:3},{months:1}]`, `usd: {...}`.

| Route | Behaviour |
| --- | --- |
| `GET /api/upgrade/catalog` | prices for the person's country and topics, current rank → expected term |
| `POST /api/upgrade/orders { product, topicId?, visibility? }` | server prices it, creates the provider order → `{ orderId, provider, checkout: {...} }` |
| `POST /api/upgrade/orders/:id/verify` | Razorpay: HMAC-SHA256(`order_id|payment_id`, key secret) check → fulfil |
| `POST /api/payments/webhook/razorpay` | `x-razorpay-signature` = HMAC(raw body, webhook secret) → `payment.captured`/`order.paid` → fulfil |
| `POST /api/payments/webhook/stripe` | `stripe-signature` (t, v1 = HMAC(`t.body`)) within 5 min → `checkout.session.completed` → fulfil |
| `GET /api/upgrade/orders/:id` | status for the return page |
| `POST /api/upgrade/waitlist` | only when international payments are switched off |

`fulfil(order)`: atomic `created → paid`; rank = ++counter[product]; term from rank; Entitlement with
`expiresAt = paidAt + termMonths`; VAVP3 → create the own topic. Mock provider: `/api/payments/mock/:id`
page with Pay / Fail buttons that calls the same fulfil path (dev and tests only).
Razorpay Checkout.js and Stripe Checkout redirect are loaded only on `/upgrade`.

## G6. Enough quotes and what's next

- Notes needed = count of slot occurrences between start and end (local dates, weekdays). Available =
  `min(itemsAvailable, maxItems)` unless the person chose to loop. If needed > available → 422
  `not_enough_quotes { needed, available, options: { endDate, timesPerDay, loop: true } }`; the client shows
  the three options.
- Every enrolment gets `endingNotice: { withinDays: 3, text: "Notifications are about to end, choose what's
  next — {daysLeft} days left", action: { kind: 'open', title: "Choose what's next", url: "<app>/next/<enrolmentId>" } }`.
- `/next/:id`: Loop again (patch `loop: true`, new end date within limits) · Extend quotes (VAVP2 pick or
  purchase) · New course (topic picker → create; the old enrolment is left to finish).

## G7. Journal

| Route | Behaviour |
| --- | --- |
| `GET /api/journal?before=` | 30 entries, decrypted |
| `POST /api/journal { text ≤ 10000, mood?: 1..5, deliveryId? }` | quote snapshot fetched from the platform with the subscriber's delivery; encrypted |
| `PATCH/DELETE /api/journal/:id` | own entries only |
| `GET /api/journal/export?format=json|md` | download |
| `DELETE /api/journal` | delete all (typed confirmation) |
| `GET/PUT /api/journal/reminder { slots, timezone, tieToTopicId? }` | separate enrolment on `journal-prompts`, or the tie (no extra notification) |

UI: one column; a large text area with a soft prompt; five mood dots; "Save" — entries below as date-grouped
cards. Opening from a quote shows the quote above the text area.

## G8/G9. App side of the spam fix; legal pages

- Platform tenant settings: `titleTemplate: '{topic} · help me outgrow'`; admin content check (regex list:
  urgency, money, prizes, "click/tap here", links, ALL CAPS) runs on add/edit and on demand.
- `android/twa-manifest.json` (Bubblewrap) and `client/public/.well-known/assetlinks.json` template; README
  steps for the owner (Play developer account).
- Pages: `/pricing`, `/refunds`, `/terms`, `/contact` (support@htsta.com).

## Tests

api (vitest + supertest, in-memory store, fake platform and fake providers): limits math, not-enough-quotes,
levels any/all, referral counting rules (own device, duplicate device, self-referral), proofs, picks,
pricing ladders and ranks/terms, Razorpay signature and webhook, Stripe webhook signature, idempotent
fulfil, VAVP3 topic creation, journal encryption at rest (no plaintext in store), export, delete-all, admin
role matrix, audit. e2e (Playwright, full stack with the real platform): onboarding through the backend,
level-up celebration and pick, referral visit from a second browser context, mock purchase, next-step page,
journal write from a quote, admin approves a proof.

## G10. Bulk import of topics from a zip (admin → Topics)

**Input**: one `.zip` (≤ 5 MB, ≤ 100 `.csv` files; other files and `__MACOSX/` are ignored). Each CSV is one topic:

```
# slug: loss                       ← required, a-z 0-9 -, 2–40
# title: Loss                      ← required for a new topic
# description: For when someone or something you loved is gone.
# sensitive: true                  ← true/false, default false
# visibility: private              ← private/public, default private
# repeat: false                    ← start again after the last note, default false
body,attribution,media,link
"Grief has no schedule.",,,
"You are allowed to rest.",A friend,https://…/rest.png,https://…/read-more
```

Note columns (header row, any order): `body` (required, ≤ 300 characters), `attribution`, `media` (also `image_url`,
`media_src`; an https image shown with the note — the original design's `media_src`), `link` (also `click_url`; the
https page the notification opens when tapped, instead of the quote page — the original "open URL" notification).

**Behaviour**: `POST /api/admin/topics/import?dryRun=1` (editor) returns a preview per file — new or existing topic,
notes to add, exact duplicates skipped, problems, spam-wording warnings — and saves nothing. Without `dryRun` it
applies: a new slug creates the topic (visibility from the file, default private); an existing slug keeps its notes
and appends only new ones (title, description, sensitive and repeat are updated; private → public is applied,
public → private is not). Files with errors are skipped whole; the rest import. One audit entry per topic.

**Batching**: the platform accepts request bodies up to 64 KB, so new notes are sent in batches of at most 56 KB of
JSON and 1000 notes (Tamil and other non-Latin scripts take 3 bytes a character). If a batch fails, the earlier ones
stay saved and the result says how many; importing the same file again adds only the notes still missing.

**Removing a note** (admin → Topics → a topic): *Remove* (editor, confirm, audited as `line.remove`) retires the
note on the platform (`POST /v1/topics/:id/items/:itemId/retire`): it is no longer sent, but keeps its place, so
nobody's position in the course moves; *Restore* brings it back. Notes are never deleted or reordered. A removed note
still counts as a duplicate, so re-importing its text does not bring it back. *Show likely duplicates only* lists
both copies of every pair of notes that share the same words or at least 80% of their words.

**Platform**: the content API accepts `clickUrl` on append and edit (https only; `{deliveryId}` and `{token}` may be
used), so a note's link survives the import (notification-service, branch `claude/fervent-mayer-fdlsam`; before it,
links were silently dropped).
