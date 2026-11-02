# PAYMENTS_INTEGRATION.md
### Fiserv-only, sandbox-verified, credential-gated — the honest payment picture

## 1. Processor decision (final)
**Fiserv (CommerceHub / Clover family) is the ONLY processor.** The decision record is
`PAYMENT_PROCESSORS_FISERV_CLOVER_ONLY.md`; no Stripe/Square/etc. code paths exist or should be added.
Revenue economics ride Fiserv's Schedule-A layered split — see the revenue-residuals engine
(`src/super-admin-revenue-residuals/*`), which computes net-first layered splits in integer cents.

## 2. The money invariant (repeated because it is the one that bites)
Integer cents everywhere; `parseDollarsToCents` is the only dollars→cents door; `check:money` hunts float money.
**No PAN, ever**: card data never touches this backend — entry/tokenization happen on Fiserv-side surfaces;
we store references, statuses, and amounts.

## 3. What is implemented and test-verified today (sandbox)
`PAYMENTS_SANDBOX=1` (the dev default) exercises the full internal flow with a sandbox processor path:
- Card/cash/split checkout on tickets; tips (shared money core + TipKeypad); surcharges; voids/refunds with
  reversal rules; skip-the-line checkout; wallet and gift-card tender; membership billing.
- Every flow lands in `payments` (+ lines/refunds), drives the commission/earnings ledgers, and is covered by
  the battery (money-engine, checkout, void/refund, settlement suites).
- Settlements + chargebacks modules ingest/reconcile processor reports (`src/super-admin-settlements`,
  `src/super-admin-disputes`) — sandbox/imported data until live creds.

## 4. Tap to Pay (manager-pay-web) — deliberate skeleton, clearly labeled
The mobile-checkout app and its API surface are complete EXCEPT the final CommerceHub capture call:
`TapToPayNotImplementedError` is thrown by design where the real SDK call goes. This is not a stub pretending
to work — it is a labeled socket awaiting **owner-provided CommerceHub sandbox credentials** (the single
biggest external blocker, unchanged for weeks). Partial-balance groundwork and payment-attempt tracking exist.

## 5. What flips when the owner provides credentials
1) CommerceHub sandbox keys → implement the capture call inside the existing TapToPay socket; run the existing
   payment-attempt suites against the sandbox. 2) Production Fiserv onboarding → `PAYMENTS_SANDBOX=0`, live
   settlement ingestion, Schedule-A numbers finalized (owner sign-off item). Until then every live-processor
   claim in TEST_REPORT.md stays **NOT VERIFIED** — by policy (§55), not oversight.
