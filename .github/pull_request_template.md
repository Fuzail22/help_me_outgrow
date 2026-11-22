## Summary

<!-- What changes for the people using the app, and why. -->

## Testing

<!-- api tests, browser tests, anything checked by hand. -->

## Before merge (owner)

Reminders for whoever merges. They live here rather than inside the app.

- [ ] **Wording people read**: privacy, terms, refunds, pricing and the care text on sensitive topics are accurate for this change. In particular, the refund window and the terms have been reviewed (by a lawyer before launch).
- [ ] **Topic content**: new or edited lines, especially on "Loss" and "Low mood", have been reviewed by someone qualified in mental-health support.
- [ ] **Settings**: any new setting this PR needs is in the GitHub `production` environment (see README → Settings). `JOURNAL_KEY` is never changed.
- [ ] **Order**: if the platform (notification-service) changed too, it is merged and deployed first.
- [ ] **After merge**: the client deploys itself; run **Deploy api (manual)** straight away when the api changed.
- [ ] **Payments**: if payments changed, one test purchase with Razorpay test keys works before live keys are used.
