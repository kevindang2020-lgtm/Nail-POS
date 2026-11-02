# AI PowerSalon Global Loyalty & Rewards Network — canonical reference

Sources: *LoyaltyTokens.pdf* v1.0, *LoyaltyRules.pdf* v2.0 (addendum), *AI_PowerSalon_Global_Loyalty_Final_Completion_Claude_Build_Guide.pdf* (30 Oct 2026).
Conflicts between them and the decisions taken: [`SPEC_CONFLICT_RESOLVED.md`](SPEC_CONFLICT_RESOLVED.md). Flags: [`LOYALTY_FLAGS.md`](LOYALTY_FLAGS.md).
Readiness: [`LOYALTY_READINESS.md`](LOYALTY_READINESS.md). Tests: [`LOYALTY_TEST_EVIDENCE.md`](LOYALTY_TEST_EVIDENCE.md). Blockers: [`LOYALTY_EXTERNAL_BLOCKERS.md`](LOYALTY_EXTERNAL_BLOCKERS.md).

## 1. Economic model (versioned rules)
| Concept | Unit / owner | Where |
|---|---|---|
| Salon prepaid token wallet | $1 = 1 token, salon-funded; spendable only at `FUNDS_VERIFIED` | `tenant_token_wallets` (projection) + `token_wallet_ledger` (authority) |
| Global customer points | tenths of a point (5 = 0.5 pt) per verified, opted-in identity | `global_rewards_accounts` (available + held projection) + `global_points_ledger` |
| Reward backing / liability | cents, double entry | `rewards_journal_entries` / `rewards_journal_lines` (deferred balance trigger, append-only) |
| Point hold | points + cents on one ticket | `reward_redemptions` |
| Salon reimbursement payable | cents owed to the ACCEPTING salon | `merchant_reimbursements` (+ `reimbursement_adjustments`) |
| Payout settlement | provider-confirmed transfer | `payout_attempts` (only SETTLED + verified proof may make a payable PAID) |

Defaults (program singleton `global_rewards_program`, global rule v1 in `global_earning_rule_versions`): $5 eligible = 0.5 point; 10 points = $1 off;
1 point consumes $0.10 of tokens. Super Admin publishes global earning versions (effective-dated, immutable); a salon's CUSTOM override is a versioned
transition (`tenant_earning_policy_versions`). A custom rule changes only the earning rate — never the redemption value or the token value. Every
earn stores its full rule snapshot (`reward_earn_transactions`: rule source, version, increment, tenths per increment, cents per point tenth).
Integer cents / tenths only (no floating point). Eligible spend excludes tax, tip, gift-card value and the reward tender itself.

## 2. Ledger ownership
| Ledger | Written by | Never |
|---|---|---|
| `token_wallet_ledger` | purchase funded (FUNDS_VERIFIED), earn allocation (debit), earn reversal (credit) | negative balance; edits (append-only trigger) |
| `global_points_ledger` | earn, redeem (on finalize), earn_reversal, redeem_reversal, adjustment | edits; running balance = available + held |
| `rewards_journal_*` | every money-shaped event, balanced | unbalanced entries (deferred trigger); edits |
| `merchant_reimbursements` | finalize (ACCRUED_OWED), Super Admin eligibility / hold, provider settlement | PAID without a SETTLED matching attempt (trigger `trg_mr_paid_guard`) |

Journal postings: purchase funded Dr settlement_cash / Cr merchant_prepaid_liability · earn Dr merchant_prepaid_liability / Cr rewards_liability ·
redemption confirmed Dr rewards_liability / Cr reimbursement_payable · payout settled Dr reimbursement_payable / Cr settlement_cash ·
redemption reversed before payout Dr reimbursement_payable / Cr rewards_liability · after payout Dr merchant_recovery_receivable / Cr rewards_liability.

## 3. Flows
**Funding** — Owner → Buy Tokens (POS, step-up, one Idempotency-Key per purchase) → provider → PAYMENT_CONFIRMED → SETTLEMENT_PENDING → FUNDS_VERIFIED
(only now credited). Lost answer → UNKNOWN ("Verification pending"), the same key resumes it. No approved provider in production → `TOKEN_FUNDING_PROVIDER_UNAVAILABLE`.

**Earning** — `checkout.completed` → `GlobalRewardsConsumer` → `earnForTicket`: one judgement per ticket; rule resolved at the ticket's paid time;
verified + explicitly opted-in identity only; funded by the EARNING salon's wallet; short wallet → BLOCKED_INSUFFICIENT_TOKENS (no fallback to a
cheaper rule, owner alerted).

**Cross-salon redemption (Checkout)**
1. POS Checkout → `GET pos/checkout/tickets/:id/rewards`: server quote (verified + opted in, salon enrolled, flags on, whole $1 blocks ≤ amount due).
2. "Use rewards" → `POST pos/checkout/tickets/:id/pay/rewards {blocks}` + `Idempotency-Key`: in ONE transaction the `global_reward` tender row and the
   HOLD (atomic compare-and-swap `available ≥ p → available −p, held +p`). A second salon racing for the same points gets `REWARDS_POINTS_INSUFFICIENT`.
3. Ticket fully paid → `checkout.completed` → `finalizeForPaidTicket` (once): HELD → CONFIRMED_REDEEMED, ledger `redeem`, payable ACCRUED_OWED for the
   accepting salon, journal. No token debit for accepting points (T13).
4. Removed on an unpaid ticket → `POST …/rewards/remove`: RELEASED + tender voided. Not paid by the deadline (`reservation_ttl_seconds`, default 900 s)
   → hold-expiry job: EXPIRED + tender voided; a ticket with an unresolved card keeps its protective hold; a paid ticket is finalized instead.
5. Refund of the reward tender → no gateway; `payment.refunded` → `reverseRedemptionForRefund`: points back, payable ADJUSTED (or ON_HOLD if a payout is in
   flight), or — already PAID — an OFFSET recovery claim (`reimbursement_adjustments`), never a rewrite.

**Payouts** — Super Admin: ACCRUED_OWED → PAYOUT_ELIGIBLE (step-up) → Pay out (step-up, Idempotency-Key, `merchant_reimbursement_enabled`) →
`PAYOUT_PROVIDER_UNAVAILABLE` while no payout provider is approved. With an approved adapter: PAYOUT_PENDING → the provider's signature-verified callback
(`applyPayoutSettlement`) → PAID only when the settled amount and reference match; mismatch → ON_HOLD + `payout_anomaly` alert.

**Books check** — `rewards-books-check.ts`: one checker for "Run check now" and the daily job (hourly tick, run key `daily:YYYY-MM-DD`, catch-up 3 days):
10 checks → PASS / WARNING / FAILED / UNKNOWN findings; FAILED raises one platform alert; nothing is auto-corrected; findings are reviewed (audit-logged).

## 4. State machines (`global-rewards-lifecycles.ts`)
`reward_redemptions`: CREATED → HELD → CONFIRMED_REDEEMED | RELEASED | EXPIRED; CONFIRMED_REDEEMED → REVERSED (compensating event only).
`merchant_reimbursements`: ACCRUED_OWED → PAYOUT_ELIGIBLE → PAYOUT_PENDING → PAID | PAYOUT_FAILED | ON_HOLD; → ADJUSTED (reversal before payout); PAID → OFFSET.
`payout_attempts`: REQUESTED → SUBMITTED → SETTLED | FAILED | UNKNOWN. Plus purchase intents, policy versions, enrollments, recon runs / findings, fraud alerts.

## 5. API contracts
| Route | Who | Notes |
|---|---|---|
| `GET pos/loyalty/network/state` · `earning/history` · `wallet` · `wallet/ledger` · `purchases` · `purchases/:id` | pos.customers.view | |
| `POST pos/loyalty/network/earning/{preview,drafts,drafts/:id/discard,activate,use-global,versions/:id/cancel}` · `purchases` | pos.settings.edit (+ step-up on activate / purchases) | |
| `GET pos/checkout/tickets/:id/rewards` | pos.checkout.view | quote + current hold |
| `POST pos/checkout/tickets/:id/pay/rewards` `{ "blocks": 2 }` + `Idempotency-Key` | pos.checkout.take_payment | → `{ payment, remainingDueCents, hold }` |
| `POST pos/checkout/tickets/:id/rewards/remove` | pos.checkout.take_payment | unpaid ticket only |
| `GET customer/global-rewards` · `POST …/opt-in {termsVersion, accept:true}` · `POST …/withdraw {reason}` | CUSTOMER session | English |
| `GET owner/loyalty/rewards` | owner.dashboard.view | own salon only |
| `GET super-admin/loyalty-network/{overview,reconciliation,enrollments,purchases,integrity,books-check/runs,books-check/findings,books-check/findings.csv,payables,redemptions/:id/lineage,fraud-alerts}` | super_admin.billing.view | |
| `POST super-admin/loyalty-network/{global-rules/preview,global-rules,global-rules/:id/cancel,program,enrollments/:tenantId,purchases/:id/sandbox-advance,books-check/run,books-check/findings/:id/review,payables/:id/{eligible,hold,payout},fraud-alerts/:id/review}` | super_admin.billing.manage (+ step-up on money / rule changes) | |

Example — apply $2 of rewards: `POST /api/v1/pos/checkout/tickets/{id}/pay/rewards` `Idempotency-Key: 6f…` `{"blocks":2}` →
`{"payment":{"method":"global_reward","amountCents":200,"status":"approved"},"remainingDueCents":2800,"hold":{"pointTenths":200,"valueCents":200,"expiresAt":"…"}}`.
Refusals carry registry codes: `REWARDS_NOT_OPTED_IN`, `REWARDS_IDENTITY_NOT_VERIFIED`, `REWARDS_POINTS_INSUFFICIENT`, `REWARD_RESERVATION_CONFLICT`,
`LOYALTY_DISABLED`, `MERCHANT_NOT_ENROLLED`, `PAYOUT_PROVIDER_UNAVAILABLE`, `TOKEN_FUNDING_PROVIDER_UNAVAILABLE`.

## 6. Code map
| Area | Files |
|---|---|
| Schema | `apps/api/db/migrations/733_global_rewards_network.sql`, `734_global_rewards_redemption_payouts.sql` |
| Engine | `modules/loyalty/src/global-rewards/` — `global-rewards-core.ts`, `global-rewards.repository.ts`, `rewards-earn.ts`, `rewards-redemption.ts`, `rewards-payouts.ts`, `rewards-books-check.ts`, `rewards-apps.ts`, `global-rewards-checkout.ts` (port + expiry / daily jobs), `global-rewards.service.ts`, controllers |
| Checkout | `modules/checkout/src/checkout/checkout.service.ts` (`rewardsQuote`, `payGlobalReward`, `removeGlobalReward`), `checkout.kysely.repository.ts` (`recordRewardPaymentAtomic`, `voidRewardPaymentAtomic`) |
| Consumer | `apps/api/src/events/consumers/global-rewards.consumer.ts` |
| POS (EN/VI) | `apps/pos-web/src/screens/loyalty/RewardsNetworkPanel.tsx`, `components/GlobalRewardsTender.tsx`, `i18n/ns/rewardsnet.{en,vi}.ts` |
| Super Admin | `apps/admin-web/src/screens/LoyaltyNetworkScreen.tsx`, `LoyaltyIntegrityTab.tsx` |
| Customer App | `apps/customer-web/src/screens/MyRewardsScreen.tsx` |
| Owner App | `apps/owner-web/src/screens/OwnerRewardsScreen.tsx` |
