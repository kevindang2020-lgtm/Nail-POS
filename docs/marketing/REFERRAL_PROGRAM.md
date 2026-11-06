# Referral Program — guide 18 handoff (Oct 31 2026)

Source: *AI PowerSalon Referral Program Complete Build Guide* (Oct 30 2026, 21 pages). Route kept: Marketing & Growth → Referrals,
`/tenant/marketing/referrals`. Migration **751** (`751_referral_program_center.sql`, additive; applied twice to the local `aps` template only).
Nothing was pushed, deployed, sent, charged or paid.

## P0 audit — what the screenshot's "2 codes / 0 referrals / $0.00 paid" meant
| Observed | Source (code / table) | Finding |
|---|---|---|
| Referral Codes 2 | `customer_referrals` (046) — one code per customer, created by the Customer App (`GET /customer/referral`) | Real: codes exist without referrals. Kept as-is (T01). |
| Total Referrals 0 | `referral_redemptions` (349) | Real: no referral was ever recorded. Empty state is now honest and explains what to do. |
| Pending Reward 0 | legacy `status = 'pending'` count | Was "recorded, not rewarded" — now **Pending Reward = rewards requested / approved but not issued** (guide §15). |
| Rewards Paid $0.00 | legacy `sum(reward_cents) where status='rewarded'` — a **hand-typed dollar amount** set by a "Reward" button | **Defect (guide §10 "never paid from a manager toggle")**: the button marked "paid" with no ledger, no approval and no qualification. Retired. Rewards Paid is now **cash with settlement evidence only** — no payout provider exists, so it is $0.00 and says why. |
| Record form | `POST /pos/referrals/record` | Only checked self-referral (same customer id) and "already referred". No first-time check, no code status, no Checkout linkage, no history. |

## What was built (all in place — no parallel referral or reward ledger)
| Area | Implementation | Status |
|---|---|---|
| Canonical state machine | `referral_redemptions.state`: RECORDED → PENDING_QUALIFICATION → QUALIFIED → REWARD_PENDING_APPROVAL → APPROVED → REWARD_ISSUED; REJECTED / EXPIRED / CANCELLED / REVERSED / UNDER_REVIEW. Machines `REFERRAL`, `REFERRAL_REWARD`, `REFERRAL_CODE` (`customer-lifecycles.ts`); every write through `canMoveToSql`. Append-only `referral_events` (trigger). | COMPLETED_AND_VERIFIED |
| Record + eligibility | `ReferralProgram.check` (read-only, reason codes, ELIGIBLE_TO_RECORD … ERROR_UNKNOWN) and `record` (one per referred customer — UNIQUE (tenant, referred) + advisory lock + idempotency key; a duplicate returns the same referral). Code active / not expired, self-referral by customer id **and** by verified identity link, first-time customer (0 visits, or a first visit inside the salon's grace hours), shared phone / email = risk signal → UNDER_REVIEW (never merged). | COMPLETED_AND_VERIFIED |
| Checkout qualification | `ReferralQualificationConsumer` (`checkout.completed`, `payment.refunded`; registered in `consumers.module.ts`). First settled, paid, non-removed ticket; net paid ≥ policy minimum; optional window; never on a booking alone. Shared card (brand + last 4) on the qualifying payment → UNDER_REVIEW. | COMPLETED_AND_VERIFIED (direct handler + harness); outbox delivery path IMPLEMENTED_NOT_VERIFIED (needs the query builder → CI) |
| Reward policy | `referral_program_settings` — reward type / value **NULL until the owner sets them** (PENDING_OWNER_APPROVAL; nothing invented). Approval required by default; optional separation of duties; min spend; window; record grace (24 h default). Versioned, audited. | COMPLETED_AND_VERIFIED |
| Reward issuance | `referral_rewards` (ONE per referral). Loyalty points post through the salon's existing `applyLoyaltyEntry` (source `('referral_rewards', id)`, at most once per entry type). Settings → Loyalty "Referral rewards" OFF holds issuance (approved, not issued). Failure → FAILED, retry reuses the issuance key. | COMPLETED_AND_VERIFIED |
| Cash payout | No approved payout provider → reward **BLOCKED_EXTERNAL**, nothing paid, never "Paid". | BLOCKED_EXTERNAL (provider + finance approval) |
| Coupon / store-credit rewards | No store-credit ledger exists; coupon issuance per referral not built. | NOT_IMPLEMENTED |
| Reversal | Full refund (net below the rule) → issued points reversed with an audited ledger `reverse` entry (clamped; spent points shown as shortfall); unissued reward rejected + referral UNDER_REVIEW; once per refund id. Manual reverse with a reason. | COMPLETED_AND_VERIFIED |
| Manager review | Approve (→ issue) / Reject / Request investigation / Clear review; reasons required; version check; separation of duties when configured; audited (`referrals.review.*`). | COMPLETED_AND_VERIFIED |
| KPIs (§15) | Codes (+active) · Total · Pending Reward · Rewards Paid (cash only) · Qualified (+issued, points) · Associated Revenue (net of refunds, "not proof of cause") · legacy hand-marked shown separately. | COMPLETED_AND_VERIFIED |
| Search / filters / dates / pages | Server-side: code, names, phone digits, email, customer / referral / reward / ticket / booking ids; matched-as referrer / referred; tabs; reward type; date basis (recorded / qualified / decided / issued / transaction) with salon-local inclusive ranges (DST-correct); newest first; pages 10/20/50; Pending Reward Reviews oldest first. | COMPLETED_AND_VERIFIED |
| Overlay (§09) | Overview · Referrer · Referred customer · Visits & Checkout (payments, refunds) · Rewards & Approvals (ledger entry, disposition) · Communication (none sent — says so) · Audit & Flags; Close / Escape; Open Booking with the customer preselected; contact masked unless `pos.customers.view`; the open is audited. | COMPLETED_AND_VERIFIED |
| Codes | List with owner / status / uses; disable (reason) / enable; versioned. | COMPLETED_AND_VERIFIED |
| Check Referral System (§16) | 11 non-mutating checks (code lookup, Customer App sync, customer search, qualification jobs (dead letters), Checkout linkage, reward policy, ledger issuance, payout provider, duplicates, recent failures, audit logging); Ready / Attention / Failed / Pending / Unknown, with evidence and next step. | COMPLETED_AND_VERIFIED |
| AI Referral Growth Assistant (§11) | Goals; verifiable metrics only (invitations "not measured"); preview never sends; Save = UNSENT Customer Segments audience → Campaign Center creates, approves and sends. | COMPLETED_AND_VERIFIED |
| Legacy routes | `POST /pos/referrals/record` and `/:id/reward` removed (no caller after the rebuild; the toggle is forbidden by the guide). `GET /pos/referrals/state` kept for the Marketing & Growth tile; the service's legacy record goes through the canonical path, the legacy reward refuses (`REFERRAL_REWARD_TOGGLE_RETIRED`). | COMPLETED_AND_VERIFIED |
| Realtime | 45 s refresh while the page is open (no realtime channel carries referral events). | IMPLEMENTED_NOT_VERIFIED |

Backfill (751): legacy pending → PENDING_QUALIFICATION, void → CANCELLED, **rewarded → UNDER_REVIEW** with the typed amount kept in
`legacy_marked_reward_cents` (shown as "hand-marked, not issued, not paid"). The legacy `status` / `reward_cents` columns are untouched.

Also fixed (exposed while regenerating the state vocabularies): `birthday_message_claims.status` (guide 17) now has a declared machine
`BIRTHDAY_MESSAGE_CLAIM` (`modules/ai/src/ai-lifecycles.ts`), and both writes go through it (birthday race 3/3, send suites pass).

## Acceptance tests (§17–§18)
| T | Evidence | Status |
|---|---|---|
| T01 codes preserved | pgtest "T01/T02" (owners match); harness KPI = DB | COMPLETED_AND_VERIFIED |
| T02 no synthetic referrals | pgtest; harness honest empty state | COMPLETED_AND_VERIFIED |
| T03 valid code → one referral, newest first | pgtest T03; harness step 3 | COMPLETED_AND_VERIFIED |
| T04 invalid / disabled code | pgtest T04; harness step 2 | COMPLETED_AND_VERIFIED |
| T05 self-referral | pgtest T05 (customer id + identity link) | COMPLETED_AND_VERIFIED |
| T06 shared family number | pgtest T06; harness step 4 (two customers kept) | COMPLETED_AND_VERIFIED |
| T07 duplicate claim | pgtest T07; race: 8 simultaneous taps → 1 referral | COMPLETED_AND_VERIFIED |
| T08 first booking only | qualification listens to `checkout.completed` only; pgtest unpaid / removed ticket | COMPLETED_AND_VERIFIED |
| T09 completed paid visit | pgtest T09 (ticket evidence); harness step 5; consumer pgtest | COMPLETED_AND_VERIFIED |
| T10 cancelled / no-show / unpaid | pgtest T08/T10 | COMPLETED_AND_VERIFIED |
| T11 manager review | pgtest T11 (self-approval refused); harness step 6 (manager) ; race: 6 approvals → 1 | COMPLETED_AND_VERIFIED |
| T12 issue one reward | pgtest T12 (one ledger entry, unique issuance key) | COMPLETED_AND_VERIFIED |
| T13 concurrent / retried issuance | pgtest T13; race: Checkout event ×8 → 1 reward, 1 posting (fails with the lock removed) | COMPLETED_AND_VERIFIED |
| T14 refund after issuance | pgtest T14; consumer pgtest; race: refund ×6 → 1 reversal | COMPLETED_AND_VERIFIED |
| T15 payout provider absent | pgtest T15 (BLOCKED_EXTERNAL, cash paid 0) | COMPLETED_AND_VERIFIED |
| T16 Customer App code | same `customer_referrals` table; pgtest inserts the code exactly as the app does | COMPLETED_AND_VERIFIED (app UI unchanged) |
| T17 27-inch layout | harness 1920×945, 1536×864, 1366×768, 1280×720, 1024×768 — no sideways scroll | IMPLEMENTED_NOT_VERIFIED on the physical ASUS / Windows 125 % (BLOCKED_EXTERNAL) |
| T18 sidebar / header | harness (existing shell, route unchanged) | COMPLETED_AND_VERIFIED |
| T19 scroll / overlay | harness (FitDialog Close / Escape) | COMPLETED_AND_VERIFIED |
| T20 code / name / phone / email search | pgtest + harness (phone digits beyond page 1, matched-as) | COMPLETED_AND_VERIFIED |
| T21 ticket / booking / reward lookup | pgtest (ticket number); booking id + reward id searchable (pgtest of ticket only) | COMPLETED_AND_VERIFIED (ticket) / IMPLEMENTED_NOT_VERIFIED (booking id) |
| T22 month-picker date range | pgtest DST (Nov 1 2026, inclusive); harness Today preset; RangeCalendar shared component | COMPLETED_AND_VERIFIED |
| T23 pagination | pgtest (17 rows / 10 per page, no duplicates); harness | COMPLETED_AND_VERIFIED |
| T24 pending review sort | `approvals` oldest first (code); harness list | COMPLETED_AND_VERIFIED |
| T25 customer detail & Booking | overlay; POS unit test (Open Booking URL) | IMPLEMENTED_NOT_VERIFIED (POS unit test needs CI) |
| T26 AI proposal preview | harness step 9 (no send) | COMPLETED_AND_VERIFIED |
| T27 consent & opt-outs | assistant uses Segments verdicts (excluded with reasons) | COMPLETED_AND_VERIFIED |
| T28 cross-tenant isolation | pgtest T28 (list, detail, code, ticket) | COMPLETED_AND_VERIFIED |
| T29 role-based approval | harness Front Desk 403; permissions `pos.marketing.manage` | COMPLETED_AND_VERIFIED |
| T30 reporting reconciliation | KPIs = independent SQL in harness; health ledger check | COMPLETED_AND_VERIFIED |
| T31 system health | pgtest T31 (non-mutating, blocked payout → attention); harness step 8 | COMPLETED_AND_VERIFIED |
| T32 migration / rollback | 751 applied twice (idempotent); rollback note in the file; staging not run | BLOCKED_EXTERNAL (staging / production approval) |

## Commands and results (Oct 31 2026)
| Suite | Result |
|---|---|
| `modules/customers/src/pos-referrals/referral-program.pgtest.vitest.spec.ts` | 22/22 |
| `…/referral-program.postgres-race.vitest.spec.ts` (PG_RACE_URL, 4 sessions) | 3/3; with the qualification lock removed, 2/3 |
| `apps/api/src/events/consumers/referral-qualification.pgtest.vitest.spec.ts` | 3/3 |
| Legacy `pos-referrals.vitest.spec.ts` / `v5-coded-refusals` / `customer-lifecycles` | 8/8 · 1/1 · 4/4 |
| Regression: marketing-growth 20/20 · birthday-center 17/17 · birthday-claims race 3/3 · send executor 13/13 · sweep 8/8 · adapters-core 7/7 · segments 13/13 · loyalty-ledger race 2/2 | all pass |
| Environment-only failures (unchanged, "query builder is not available"): ai-lifecycles 7/9, loyalty-ledger pgtest 5/7, loyalty-points pgtest 2/13 | CI |
| Harness `rf` (Chromium; EN/VI; Front Desk 403; 5 screen sizes) | 11/11 |
| Combined run `seg,cp,do,promo,cc,mg,mt,cn,pm,bv,ms,eod,fuq,rmd,em,wb,bd,rf` | 191/191 (one known harness page error after Open Booking: "not in the harness") |
| `comms` section | 12/12 |
| Gates: 62 `check:*` | 52 pass via npm, 6 via the stand-in (sql, types-drift, sql-identifiers, db-ownership, unique-tenant-review, actor-stamp), 4 can't run here (boot, lint, api-contract, strict-bodies-types) |

## Not verified / blocked
- **IMPLEMENTED_NOT_VERIFIED (CI):** POS + API type-check; `POSReferralsScreen.test.tsx` (rewritten; the old `.403` test merged in); the outbox delivery path of the consumer.
- **BLOCKED_EXTERNAL:** cash payouts (approved payout provider + finance / legal approval); physical ASUS 27″ at 100 % and Windows 125 %; migration 751 on staging / production.
- **NOT_IMPLEMENTED:** coupon and store-credit referral rewards; referral invitation / confirmation messages; a realtime channel for referral events (45 s refresh instead).

## Open owner decisions (PENDING_OWNER_APPROVAL — nothing invented)
1. **Reward**: type (loyalty points today; cash is blocked) and value — none is set, so qualified referrals wait.
2. **Qualification rule**: first completed paid visit (current); minimum spend ($0 default); window (none default); recording grace (24 h default).
3. **Approval**: manager approval required (default on); separation of duties (default off — a solo owner could not approve otherwise).
4. **Legacy hand-marked rewards** (UNDER_REVIEW after backfill): honour them (issue points), or reject them?
5. Should Front Desk be able to record referrals? Today it has no marketing access (403), as for Coupons / Birthdays.

## Built Nov 6 2026 (A18 — Kevin: "continue finish all")

- **List filters.** Branch (or "no branch"), risk signals (flagged / clean), recorded by, reviewed by. The people and branches in the
  filters come from real rows (`GET /pos/referral-program/filter-options`).
- **More risk signals.** These still only send a referral to a person for review; nothing is merged or confiscated.
  - `referral_velocity`: more than 3 referrals by one referrer in 7 days.
  - `existing_customer`: the new customer had a paid visit before this referral.
  - `same_name`: the referrer and the new customer have the same first and last name.
- **Communication tab.** Shows the salon's messages to the referrer and to the new customer. The program itself still sends nothing.
- **Recorded checks.** `POST …/health/run` records each run in `referral_health_runs` (migration 832); `GET …/health/last`
  returns the latest. `GET …/health` stays non-mutating.
- **Tests:**
  - `referral-program.pgtest` (25). T15 was rewritten for the velocity truth: earlier referrals are moved a month back.
  - `POSReferralsScreen.test` (7)
