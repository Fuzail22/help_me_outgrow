# Build progress: growth (VAVP), platform-as-backbone, payments, journal

Read this first when a run resumes (also after a token/usage limit). Update it at the end of every step.
Design: help_me_outgrow `docs/design/HLD.md`, `LLD.md`; notification-service `docs/design/v2-HLD.md`, `v2-LLD.md`.
Branch in both repos: `claude/eager-ritchie-5245sb`. Before starting a step, `git fetch` both repos and read
this file on the newest commit of that branch.

Owner decisions (20 Nov 2026): Razorpay (India) + Stripe (international), test/mock keys only; Google + Zoho
sign-in everywhere; admin roles owner/editor/support/viewer; 1 approved social post = 1 referral; paid terms by
buyer rank per product (10 → 12 mo, 10 → 6, 50 → 3, rest 1); VAVP2 ₹10/+3, ₹50/+20; VAVP3 ladders configurable,
same terms; ending text "Notifications are about to end, choose what's next — x days left"; journal export and
delete-all for the user only; carry on without stopping unless the owner objects.

| Step | Repo | State | Notes |
| --- | --- | --- | --- |
| Design (HLD/LLD) | both | done | |
| P1–P4 policy, secret-key enrolments, content API, scopes, isolation suite | NS | done | `c41294f`. Routes are `/v1/accounts/:externalId/…` (not `/v1/subscribers/:x`, which collides with `me`). v1 browser routes keep the ladder while `browserEnrolments` is on. New tenants: no `content:write`, browser enrolments off (`bootstrap --privileged --browser-enrolments`). |
| P5–P6 delivery: buttons, tag, title, ending notice, maxItems, loop, gap, cap, snooze; SDK 0.6.0 | NS | done | `8dd333f`. Gap = atomic per-person reservation at send time + check at enrolment time. Ending notice: `{daysLeft}`, `{daysLeftText}`. |
| P7 console: policy page, read-only topics, slots removed, Zoho | NS | done | `c81b608`. Judgement call: console content edits kept for operators (emergency), with the tenant role still applied; legacy slot page operator+owner. NS server 154 tests, e2e 20. |
| G0 enrolments through the backend, store, limits | HMO | done | Generic store (memory/mongo), 0.5 user docs migrated on read, settings docs (limits/growth/pricing), `/api/me/limits`, `/api/enrolments`, SDK 0.6.0 vendored. hmo e2e: bootstrap without `--browser-enrolments`. Note: e2e must use the global Playwright (no local `npm install` in e2e). |
| G1 Zoho, admin roles, audit | HMO | done | Zoho OIDC code+PKCE for app users (same verified email = one account); admin at `/admin` (lazy chunk), roles owner/editor/support/viewer, `x-admin` CSRF header, audit log; settings screens with explanations and price preview. api 27 tests, e2e admin 1. |
| G2+G3 levels, celebration, referrals, proofs | HMO | done | Levels evaluated on read (ratings from platform summary, cached 60 s); visits per (code, device), owner devices excluded (also retroactively); proofs reviewed by support; one atomic pick per level; celebration dialog with padlock animation (reduced-motion aware). |
| G4 VAVP1/2/3 | HMO | done | VAVP1/2 via entitlements (VAVP2 also patches running courses); VAVP3 own topics (private platform topic, public after editor review, 150-line cap, stops when the privilege ends); admin Topics page (content API) with the spam-wording check (G8 part). api 38 tests; e2e growth 3. |
| G6 enough quotes, ending notice, next page | HMO | done (with G0) | Onboarding warns before sign-in (`/api/public/config`), server checks again; `/next/:id` loop / extend / new course (validated before the old course is stopped). |
| G5 payments (Razorpay, Stripe, mock) | HMO | done | Server-priced orders; Razorpay checkout signature + webhook, Stripe Checkout + signed webhook (5 min tolerance); atomic fulfil (one grant per order); buyer number per product family → term; VAVP1 n-th unit pricing; waitlist when international is off; renewal banner (3 days). No live keys: owner creates accounts. api 46 tests, e2e upgrade 1. |
| G7 journal | HMO | done | AES-256-GCM per person (HKDF of JOURNAL_KEY + user id, AAD = user id); export JSON/Markdown and typed delete-all for the user only; admin sees counts/dates; reminders: own times = looping enrolment on the shared private `journal-prompts` topic (Write now / Later snooze), or tie = "Journal on this" button on a quote topic (no extra notification). Fixed: `$set` with `_id` failed on a second settings save. api 52, e2e journal 1. |
| G8/G9 content check, TWA, legal pages | HMO | done | Content check (G4); platform gap/cap/tag/title (P5); Android install card; `android/` Trusted Web Activity manifest + owner steps; pricing (live from settings), refunds, terms, contact pages (drafts to review). |

## Log
- 2026-11-20: design written and pushed for review.
- 2026-11-20: notification-service v2 (P1–P7) built and pushed. Next: HMO G0.
- 2026-11-20: HMO G0 + G6 built: api 18 tests, e2e 21. Judgement calls: admin api lives under `/api/admin/*` (one proxy prefix); "loop" and "new course" start a new enrolment from today with the same times (the old one is cancelled after every check passes); "extend" raises maxItems on the running one. Next: G1.
- 2026-11-20: G1 built. Admin identity = signed-in user's verified email in `admins` (ADMIN_OWNER_EMAIL bootstraps). Next: G2+G3.
- 2026-11-20: G2–G4 built (with the G8 content check). Next: G5 payments.
- 2026-11-20: G5 built. Renewal reminder is an in-app banner on My notes (not inside notifications). Next: G7 journal.
- 2026-11-20: G7 built. Next: G8/G9 (TWA, legal pages), then full regression and docs.
- 2026-11-20: G8/G9 built. Full regression green: NS server 155, SDK 13, console e2e 20; HMO api 52, e2e 27. All steps done. Remaining are owner inputs (keys, accounts, Play listing, legal review) — see README "Going live".
- 2026-11-21: owner created the Razorpay account. Stripe does not offer India at sign-up (invite only), so international payments go through Razorpay in USD (`RAZORPAY_INTERNATIONAL=1` after Razorpay activates International payments). Stripe code kept, unused. api 54.
- 2026-11-22: Razorpay checklist review: deploy now accepts RAZORPAY_KEY_ID from a secret or a variable; checkout handles payment.failed and dismiss; prices must be 0 or ≥ 100 subunits (USD defaults $0.99 → $1.00); bad API keys logged as an alert. Checked against Razorpay test mode: real INR and USD orders created, signature verified. api 57.
- 2026-11-22: G10 bulk import (zip of CSVs, one topic per file; header lines + notes with media/link) built. Needs notification-service clickUrl support (PR #10 there). api 60, e2e import 1.
- 2026-11-23: G11 groups and topic audiences (admin → Groups; a topic is shown to everyone or only to chosen groups and people; enforced in `topicsFor`; losing access stops new courses only). api 68 (+8), e2e audiences 1.
- 2026-11-23: G10 fixes: imports larger than the platform's 64 KB request limit failed ("Body is too large"); notes now go in ≤ 56 KB batches. Admin can remove (retire) and restore a note, and list likely duplicates. Found that the platform never stored a note's own link (the earlier PR there only had a Zoho fix); fixed in notification-service with remove/restore. api 63, e2e import + remove-note.
