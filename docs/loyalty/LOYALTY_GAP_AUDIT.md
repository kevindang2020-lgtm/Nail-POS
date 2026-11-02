# Global Loyalty & Rewards — Phase 0 gap audit (Final Completion guide, 30 Oct 2026)

Audited at commit `369e6739` against *AI_PowerSalon_Global_Loyalty_Final_Completion_Claude_Build_Guide.pdf* (§01–§17),
*LoyaltyRules.pdf* v2.0 and *LoyaltyTokens.pdf* v1.0. Status per row: **DONE** (built + executed tests), **PARTIAL**,
**MISSING**, **CONFLICT** (documented in `SPEC_CONFLICT_RESOLVED.md`, no silent change).

## Canonical sources located
| Item | Where |
|---|---|
| T01–T24 definitions | LoyaltyRules.pdf v2.0 §8.2 (all 24 present — none BLOCKED_SPEC) |
| Token test groups | Final guide §13 "Additional token test groups" |
| Ledger schema | `apps/api/db/migrations/733_global_rewards_network.sql` |
| Engine | `modules/loyalty/src/global-rewards/*` |
| Checkout tender seam | `modules/checkout/src/checkout/checkout.service.ts` `applyBookingDeposit` + `checkout.kysely.repository.ts` `recordDepositPaymentAtomic` (port pattern reused for reward holds) |
| Paid-ticket event | `DOMAIN_EVENTS.CHECKOUT_COMPLETED` → `apps/api/src/events/consumers/global-rewards.consumer.ts` |
| Customer identity | `customer_identities.phone_verified_at` + `customer_identity_links` + `global_rewards_accounts` |

## Gap checklist
| § | Requirement | Before this phase | Plan |
|---|---|---|---|
| 02/03 | Separate wallet / points / backing / payable ledgers, append-only, unique source refs | **DONE** (733: `token_wallet_ledger`, `global_points_ledger`, `rewards_journal_*`, `merchant_reimbursements`) | keep; add hold + payout records |
| 03 | available = total − held, never negative | **PARTIAL** (columns `available_tenths`/`reserved_tenths`; nothing holds yet) | atomic CAS hold |
| 04 | Cross-salon Checkout redemption (hold → paid → finalize; release/expire) | **MISSING** (tables only) | `GlobalRewardsCheckoutPort` + `payGlobalReward` tender + consumer finalize + expiry job |
| 05 | Reservation lifecycle CREATED/HELD/CONFIRMED_REDEEMED/RELEASED/EXPIRED/REVERSED | **CONFLICT** (733 used RESERVED/COMMITTED/HELD) | migration 734 re-vocabulary (no rows exist anywhere — 733 never deployed) |
| 05 | Reimbursement ACCRUED_OWED/PAYOUT_ELIGIBLE/PAYOUT_PENDING/PAID/PAYOUT_FAILED/ON_HOLD/ADJUSTED/OFFSET | **CONFLICT** (733 used PAYABLE/BATCHED/SUBMITTED/…) | migration 734; PAID only via verified payout settlement |
| 05 | Refund of a redemption ticket → compensating reversal; post-payout = offset claim | **MISSING** | consumer on `payment.refunded` for `global_reward` tenders |
| 06 | payout_attempts with settlement proof | **MISSING** | table + `PayoutProvider` seam (no live provider → BLOCKED_EXTERNAL) |
| 06 | reconciliation_runs / findings | **MISSING** (manual check returns JSON only) | tables + shared checker |
| 06 | program_memberships (consent version, opt-in time, withdrawal, source) | **PARTIAL** (`global_rewards_accounts` has terms_version, enrolled_via) | add opted_in_at / status / withdrawn_at |
| 07 | Daily automatic books check, idempotent run key, history, heartbeat, alerts | **MISSING** | scheduled job + manual button share one checker |
| 08 | Super Admin integrity dashboard (KPIs, drilldowns, finding review, CSV) | **PARTIAL** (Reconciliation tab) | integrity tab |
| 09 | Review-first fraud alerts | **MISSING** | detector over holds / payables / refunds |
| 10 | Customer App My Rewards + explicit opt-in (English) | **MISSING** | customer-web screen + routes |
| 11 | Owner App Rewards (English, own tenant) | **MISSING** | owner-web screen + routes |
| 12 | Independent flags; pilot allowlist | **PARTIAL** (7 flags, rollout allowlist via `platform_flag_rollouts`) | add hold/redeem + nightly-recon + payout flags to the list |
| 13 | T01–T24 + token groups executed with evidence | **PARTIAL** (engine 22 tests, E2E 12 + 7) | evidence matrix; BLOCKED where not executable here |
| 13 | Full POS / Admin type-check in CI | **NOT RUN LOCALLY** (no React types in this environment) | `IMPLEMENTED_NOT_VERIFIED` until CI runs |
| 14 | LOYALTY docs, SPEC_CONFLICT_RESOLVED, flags, readiness matrix, blockers, CONTINUE_HERE | **MISSING** | write in `docs/loyalty/` + update CONTINUE_HERE |

## Blocked approvals identified (out of code)
1. Approved payment provider for real token purchases (BLOCKED_EXTERNAL).
2. Approved payout provider for real salon reimbursements (BLOCKED_EXTERNAL).
3. Qualified legal / accounting review of the funding model, chart of accounts and refund policy (BLOCKED_EXTERNAL).
