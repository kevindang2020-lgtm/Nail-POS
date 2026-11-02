# AIPowerSalon — Launch Readiness & Decision Register

A single go/no-go view: what's done and verified, the money-path audit results, and the decisions/blockers that are
**yours** to resolve. (Pairs with the per-area reports: `CASH_SECURITY_AUDIT`, `PAYMENT_PATH_AUDIT`, `WALLET_LEDGER_AUDIT`,
`BILLING_AUDIT`, `IOS_SUBMISSION_RUNBOOK`, and the `apple-readiness/` set.)

## ✅ Production-ready & verified here
- **Cash subsystem (end to end):** register drawer (float, sales, refunds, mid-shift cash in/out with void), technician
  hand-offs, owner daily close-out, and a CSV export. All live-verified.
- **Money-path security:** cash, card, PCI, wallet, and billing all audited; real fixes landed (see results below).
- **iOS shells (all five surfaces):** customer / owner / tech (App Store) + customer-display / check-in kiosk (ABM),
  each with a real branded icon + splash. Consumer apps are compliant (account-deletion + privacy-export endpoints,
  Privacy/Terms screens, marketing-opt-in split) and accessible (keyboard-activatable controls, Escape-to-close modals).
- **Tests (all green):** api **447** · pos-web **64** · owner-web **21** · customer-web **89** · tech-web **33**. All
  five frontends + the API build clean.

## 🔒 Money-path audit results
| Path | Result | Fix landed |
|---|---|---|
| Cash drawer/movements/hand-offs | sound | added void/correction (no un-correctable entries) |
| Card checkout + refunds | sound | concurrent same-key idempotency returns the real row id |
| PCI / card-data handling | sound | webhook-payload scrubber made recursive (nested secrets) |
| Customer wallet ledger | **clean** | none needed (advisory-lock overdraw safety, idempotent, no free credit) |
| Billing (hardware auto-charge) | **bug found & fixed** | idempotency guard — a re-run/recalculate no longer **double-charges** the salon |

The billing double-charge was the key catch: re-running a month (cron or the super-admin "recalculate-month") used to
charge the saved card twice. Fixed + regression-tested.

## 📋 Decisions only you can make (nothing here is a bug-blocker — they're choices)
1. **`MONEY_PATH_QA` items:** split-payment surcharge behavior, whether tax/surcharge should be tenant-configurable,
   settings-schema tightness. Tell me the intended behavior and I implement each.
2. **Billing — "recalculate-month" semantics:** retrying a *failed* (not paid) month still re-posts ledger / re-reduces
   principal. The right behavior depends on whether "recalculate" means *first-run-only* or *reverse-and-recompute* —
   that's a design call. (The card double-charge itself is already fixed.)
3. **Belt-and-suspenders:** add a per-(plan,month) advisory lock to billing (like the wallet has) to close the
   theoretical concurrent-reconcile race. Low urgency.
4. **Skip-the-Line collision:** make its rare concurrent same-key path return the existing payment instead of a transient
   error (approach documented in `PAYMENT_PATH_AUDIT`).

## 🚧 Launch blockers that need your hardware / accounts (not code)
- **Apple:** a Mac + Xcode + Apple Developer enrollment → sign, archive, upload to TestFlight. Every step (with your
  bundle IDs filled in) is in `IOS_SUBMISSION_RUNBOOK.md`. Then an on-device VoiceOver / Dynamic Type pass.
- **Production config:** absolute `VITE_API_BASE` (and `window.APS_API_BASE` for the kiosk), a real Fiserv/CardPointe MID,
  Twilio + A2P 10DLC, SendGrid, hosting/Redis/domain, and Google Places/Maps keys.

## Suggested sequence
1. Stand up the prod API + set the absolute API base; smoke-test one app against it.
2. Run the iOS runbook for the **Owner** app first (simplest), then the rest → TestFlight.
3. Resolve the `MONEY_PATH_QA` choices (#1) so checkout math matches your merchant agreement before real charges.
4. Decide the billing "recalculate" semantics (#2) before the first monthly hardware reconciliation runs.
