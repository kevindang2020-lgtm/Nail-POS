# PAYMENT_RECONCILIATION_REPORT.md — CardPointe, UNKNOWN, split guard, top-up, app pay, refunds (FullSystemTest.pdf §79, B2)

| | |
|---|---|
| Date | 2026-10-28 |
| Commit | code `07e599ea` (`merge-github-main`) |
| Environment | sandbox, real PostgreSQL 16 for database checks; **no API build** (no `node_modules`), so no HTTP-level payment run this time |
| What was executed now | database-level money invariants (concurrency, idempotency, locks); the payment modules' unit specs through the stand-in harness; code inspection of the card / Tap to Pay paths |
| Prior executed evidence (older commits, linked, not re-run) | Oct 27 final pass (`22a98978`, evidence committed in `fe1080e6`): race lane 99 files / 336 tests PASS (`docs/pilot-runs/2026-10-27-final/race.txt`), pilot day **235 / 235** incl. phase 14 recovery flows 4 / 4 (`docs/pilot-runs/2026-10-27-final/pilot.txt` lines 292–296), `TEST_REPORT.md` "Oct 27 2026 — final pass". (`NEXT_STEPS.md` I-2 cites `docs/pilot-runs/2026-10-27-recovery/`, which does not exist — the recovery lines are in the final-pass `pilot.txt`.) |

**Three things are tracked separately, as the mandate requires (§79):** provider-mock tests (PASS where listed), the CardPointe
sandbox (loopback / sandbox fake — PASS Oct 27), and a **real MID UAT (BLOCKED_EXTERNAL — never run)**. Live processing is not
ready until the last one passes.

## 1. Results by flow

| Flow | Mandate expectation | This run (Oct 28) | Last full run | Status now |
|---|---|---|---|---|
| Card charge idempotency | one charge per key under concurrent submits | DB: 20 concurrent inserts with one key → 1 row, 19 refused by `payments_tenant_idem_uq` (negative control: 20 rows once the index is dropped). Code: `CheckoutService.payCard` claims the key with an in-flight row **before** calling the processor; key from the request or `buildIdempotencyKey(ticket,'card',due)`; replay of an approved key returns the prior payment. Unit: `checkout-card-idempotency` 7 / 7 | race lane Oct 27 | PASS (DB + unit) · API race NOT_TESTED on this commit |
| UNKNOWN is never a decline | a lost provider reply stays UNKNOWN / processing; staff Verify or the sweep settles it once | unit: `checkout-card-verify` 7 / 7, `checkout-refund-unknown` 21 / 21, `payment-attempt-sweep` 13 / 13 (+ interval 3 / 3), `mobile-attempt-recovery` 7 / 7, `mobile-recovery-convergence` 5 / 5, `ttp-recovery-lookup` 8 / 8 | pilot 14 (wallet top-up, Skip-the-Line, split card, refund timeout) 4 / 4 | PASS (unit) · e2e NOT_TESTED on this commit |
| Split-tender guard (no cash / gift / second card / Tap to Pay while a card is unsettled) | all conflicting tenders blocked until conclusive | unit: `checkout-split-segment-guard` 5 / 5, `checkout-split-surcharge` 15 / 15, `checkout-split-card-compensation` 2 / 2, `split-payments` 4 / 4. `mobile-unsettled-guard` (fail closed when the unsettled view cannot be read): ENV — the stand-in lacks `mockRejectedValue` | `split-tender-lost-card.postgres-race` (mutation-checked) Oct 27 | PASS (unit) · the fail-closed spec BLOCKED_DEPENDENCY |
| Wallet top-up | one credit per intent, webhook and poll converge | unit: `wallet-topup-intents` 16 / 16, `payment-webhook-topup` 3 / 3 | pilot 14a | PASS (unit) |
| Skip-the-Line / customer app pay | one payment; lost answer → Verify | covered by the recovery specs above | pilot 14b | PASS (unit) |
| Refunds / voids | cumulative cap under an advisory lock; approval over the salon limit; a refund timeout settles once; commission reversal | unit: `checkout-refund-guard` 7 / 7, `checkout-refund-atomic` 4 / 4, `checkout-partial-refund-reversal` 6 / 6, `checkout-ticket-refund` 8 / 8, `checkout-void-guard` 10 / 10, `refund-approval.engine` 7 / 7, `refund-orchestration` 5 / 5, `refunds-voids` 5 / 5. `refund-approval.pgtest` (real-PG advisory lock): ENV (Kysely) | pilot 14d + race lane | PASS (unit) · pgtest BLOCKED_DEPENDENCY |
| Refund inquiry auto-release | never releases without a verified inquiry shape | `PAYMENTS_REFUND_INQUIRY_VERIFIED` must be `1` before the sweep auto-releases (`d8f2967e`); default off | — | SAFE DEFAULT · real shape BLOCKED_EXTERNAL (P0-2) |
| Gift card | no stored value without payment; one ledger write in the transaction | `POST /pos/checkout/gift-cards` answers **410 ENDPOINT_RETIRED** (read in `checkout.controller.ts:98`); unit: 9 gift-card specs pass (amount guard 11 / 11, charge core 13 / 13, issue-retired 1 / 1, lookup, reload, sale) | e2e-giftcard rewritten Oct 28 (not run) | PASS (unit) |
| Cash drawer | cash part of a split counted once; no declined rows | `cash-drawer-core` 20 / 20; `cash-drawer-split-cash.pgtest`: ENV (Kysely) | — | PASS (unit) |
| Deposit / settlement reconciliation | duplicates, fees, exceptions, adjustments, webhook | 9 `deposit-reconciliation.*` specs pass (duplicates 9 / 9, fees 12 / 12, exceptions 8 / 8 …); `hardware-payment.reconciliation-job` 7 / 7 | — | PASS (unit) |
| Tap to Pay (per-location merchant, refunds / voids in the POS) | the location's own CommerceHub merchant; refund on the same rail | unit: `ttp-refund-in-pos` 6 / 6, `capture-result` 7 / 7, `capture-bridge` 6 / 6, `mobile-payment-attempt` 7 / 7, `mobile-partial-attempt` 5 / 5. `mobile-route-idempotency.pgtest`, `device-identity` (fake timers), `mobile-branch-switch` (Nest module metadata): ENV | Secure Tap pilot S10–S14 133 / 133 (Oct 26) — **before** the per-location MID change | PASS (unit) · CommerceHub VERIFY markers BLOCKED_EXTERNAL |
| Merchant isolation | a salon's payment goes through its own merchant only | Super Admin per-tenant / per-branch gateway config; Tap to Pay MID per location (migration 704); DB: payments keyed by tenant (RLS tested) | pilot cross-tenant probe (phase 11 §66) | PASS (DB) · API NOT_TESTED on this commit |
| Real CardPointe MID: $1 sale → void → refund inquiry | authorized UAT | — | never | **BLOCKED_EXTERNAL (P0-2, Kevin)** |

## 2. B2 "payment safety race" — mapping

| B2 step | Where it is proven | Status on this commit |
|---|---|---|
| 1–2 lost reply → UNKNOWN, not declined | `checkout-card-verify`, `checkout-refund-unknown`, pilot 14c | unit PASS; pilot NOT_TESTED |
| 3–4 cash / second card / gift / Tap to Pay blocked from a second station | split guards above; `assertNoUnsettledCard`; `split-tender-lost-card.postgres-race` | unit PASS; race lane NOT_TESTED |
| 5 APPROVED / DECLINED / NOT_FOUND settled separately | `payment-attempt-sweep`, `mobile-recovery-convergence`, `ttp-recovery-lookup` | unit PASS |
| 6 no double charge, no overpayment, immutable audit | DB idempotency + audit append-only + TRUNCATE refusal (db-races 22 / 22) | PASS |

## 3. Open payment items

| ID | Severity | Item | Owner |
|---|---|---|---|
| P0-2 | P0 | Real MID UAT per salon (`cd apps/api && npm run uat:cardpointe`), confirm the `inquireByOrderid` refund listing shape, then `PAYMENTS_REFUND_INQUIRY_VERIFIED=1` | Kevin + Fiserv |
| V-28 | P0 (verification) | Race lane + pilot phase 14 on this commit (`TEST_RESULTS.md` §7) — the per-location MID (`e574752d`) and POS refund (`33034f61`) changes have unit tests only | developer |
| E-TTP | P2 | CommerceHub sandbox: VERIFY markers in `modules/payments/src/payments/commercehub.client.ts`; confirm one ISV key acts for each location MID | Kevin + Fiserv |
| W-4 | P2 | Payroll payout provider (ACH / clearance) — check + cash work without it | Kevin |
