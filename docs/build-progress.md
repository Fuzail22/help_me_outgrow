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
| P1–P4 policy, secret-key enrolments, content API, scopes, isolation suite | NS | todo | |
| P5–P6 delivery: buttons, tag, title, ending notice, maxItems, loop, gap, cap, snooze; SDK 0.6.0 | NS | todo | |
| P7 console: policy page, read-only topics, slots removed, Zoho | NS | todo | |
| G0 enrolments through the backend, store, limits | HMO | todo | |
| G1 Zoho, admin roles, audit | HMO | todo | |
| G2+G3 levels, celebration, referrals, proofs | HMO | todo | |
| G4 VAVP1/2/3 | HMO | todo | |
| G6 enough quotes, ending notice, next page | HMO | todo | |
| G5 payments (Razorpay, Stripe, mock) | HMO | todo | |
| G7 journal | HMO | todo | |
| G8/G9 content check, TWA, legal pages | HMO | todo | |

## Log
- 2026-11-20: design written and pushed for review.
