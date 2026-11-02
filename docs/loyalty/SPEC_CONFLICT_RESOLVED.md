# SPEC_CONFLICT_RESOLVED — Global Loyalty & Rewards

Every place where the three loyalty specifications (or a spec and the existing code) disagreed, the decision taken in code, the owner who must confirm,
and the modules affected. **Open** items need an explicit owner / finance / legal decision; the code takes the conservative reading until then.

| # | Conflict | Decision in code | Status / owner | Modules |
|---|---|---|---|---|
| C-1 | Reservation states: Tokens §6.4 / 733 used `RESERVED / COMMITTED`; Final guide §05 uses `CREATED → HELD → CONFIRMED_REDEEMED / RELEASED / EXPIRED → REVERSED` | Final guide vocabulary (734). 733 never deployed — no data to migrate | Decided (latest spec) — owner to confirm | loyalty, checkout |
| C-2 | Payable states: Tokens §7.4 `PAYABLE / BATCHED / SUBMITTED / PROCESSING / UNKNOWN / FAILED / PAID`; Final guide `ACCRUED_OWED → PAYOUT_ELIGIBLE → PAYOUT_PENDING → PAID / PAYOUT_FAILED / ON_HOLD / ADJUSTED / OFFSET` | Final guide vocabulary; provider-level states (submitted / unknown) live on `payout_attempts`. T15's "PAYABLE/BATCHED never shown as PAID" maps to ACCRUED_OWED / PAYOUT_ELIGIBLE / PAYOUT_PENDING | Decided — owner to confirm | loyalty, admin, owner app |
| C-3 | Suggested API `POST /loyalty/redemptions/holds …` (Final §06) vs Tokens §10 `POST /checkouts/:id/reward-reservations` vs existing checkout conventions | Holds are a CHECKOUT tender: `POST pos/checkout/tickets/:id/pay/rewards`, `…/rewards/remove`; finalize is the paid-ticket event (never a client call) | Decided (match existing conventions, guide §06 allows) | checkout |
| C-4 | Suggested `GET /loyalty/customer/me/rewards`; `/customer/rewards` already belongs to the salon's own tenant program | `GET /customer/global-rewards` (+ opt-in / withdraw) | Decided | customer app |
| C-5 | Refund of an earning sale: "cumulative refunded eligible amount" vs per-refund proportional | Cumulative refunded amount against the ORIGINAL snapshot, at most once per refund id; spent points become a recorded exception | **Open — finance sign-off** | loyalty consumer |
| C-6 | Hold TTL: no global duration mandated (Final §04) | `reservation_ttl_seconds` default 900 s, Super Admin-editable (60–86 400); a ticket with an unresolved card keeps its protective hold past the TTL | Decided default — **owner to confirm the value** | loyalty, checkout |
| C-7 | Expiry of points: "only if actually supported" (Final §10) | No expiry implemented; the Customer App says "Points do not expire" | **Open — legal / program policy** | customer app |
| C-8 | Withdrawal: "approved liability / retention policy, not silent forfeiture" | Withdrawal keeps the points (liability stays), blocks new earning and spending; refused while a hold is active | **Open — legal: retention period / closure policy** | loyalty, customer app |
| C-9 | Opt-in: earlier engine accepted any active account; Final §10 requires explicit consent | Earning AND redeeming require `opted_in_at` (and no withdrawal); existing 733 rows backfilled from `enrolled_at` / `enrolled_via` | Decided (stricter) | loyalty |
| C-10 | Custom-earning flag turned OFF while a salon has an active custom rule | The active custom version stays in force (no silent repricing); new edits / activations refused | Decided — owner to confirm | loyalty |
| C-11 | Redemption granularity: "10 points = $1" | Whole blocks of 10 points ($1), never more than the ticket owes (tax / tip rules of Checkout apply to the remaining tenders) | Decided — owner to confirm | checkout |
| C-12 | Sandbox payouts: Final §05 "a simulated event cannot constitute payment confirmation" | No sandbox payout provider exists; DB CHECK refuses SETTLED for `provider = 'sandbox'`; PAID only through a verified provider callback | Decided | loyalty |
| C-13 | Chart of accounts: Tokens §7.2 lists 10 accounts (clearing, suspense, subsidy, revenue …) | 6 accounts implemented: settlement_cash, merchant_prepaid_liability, rewards_liability, reimbursement_payable, funding_deficit_receivable, merchant_recovery_receivable | **Open — accountant to approve / extend** | loyalty |
| C-14 | "Partial payments, split tender, taxes, tips, chargebacks follow the approved Checkout/finance policy" | Reward tender behaves like a stored-value tender (no surcharge, no gateway); chargeback of a token PURCHASE after consumption → funding deficit is modelled (account) but no chargeback webhook is wired (no provider) | **Open — finance policy + provider** | checkout, loyalty |

Open finance / legal questions (consolidated): C-5, C-6 value, C-7, C-8, C-13, C-14, and the funding model itself (collecting salon prepayments for
cross-salon rewards — LoyaltyTokens §12.3) — see `LOYALTY_EXTERNAL_BLOCKERS.md`.
