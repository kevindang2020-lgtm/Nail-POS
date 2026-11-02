# Booking Phone Verification — build record (guide 10 of the set, Oct 31 2026)

Source: *AI PowerSalon Booking Phone Verification — Complete Claude AI build and repair guide* (13 pages, 30 Oct 2026).
Route kept: `/tenant/communications/phone-verification`. Status words are the guide's §22 labels.

## Discovered baseline (before this build)

The module was already mature and is **reused, not duplicated**:

| Piece | Where | Notes |
|---|---|---|
| Policy resolver (pure; precedence platform → tenant → branch → channel → history → special rules) | `booking-verification-policy.ts` (`bpv-1`) | never downgrades; provider broken + required ⇒ blocked |
| One gate for every remote channel | `booking-verification-guard.ts`, `booking-verification-flow.ts` (`VerifiedBookingFlow`) | customer app, public link, AI receptionist |
| OTP send / check | `booking-verification.service.ts` | tenant's OWN Twilio (Verify Service, or an internal code texted from the salon's number, only its bcrypt hash stored); attempt budget, resend cooldown, IP / device limits, enumeration-safe answers |
| Sessions | `booking_verification_sessions` (367/521) | phone hash + mask, never the code; one appointment per proof (`uq_bvs_consumed_appointment`) |
| Slot holds | `booking_holds` + `booking_holds_no_overlap` (gist exclusion), 1-minute sweep | hold BEFORE send; conversion guarded |
| Settings | `booking_verification_settings` (+ branch rows, versioned, audited) | six channel columns; the in-salon three were decided OFF (Phase 4) |
| Platform oversight | `super-admin/booking-verification` | emergency disable / require / block / module |
| Manager override | `pos/booking/verification-override` | reason + how the customer was confirmed; audited |

**Discrepancies found and fixed:**

| # | Finding | Severity | Fix |
|---|---|---|---|
| D1 | An EXPIRED hold the sweep had not reached yet (up to 60 s) still counted for the no-overlap constraint, so the next customer was told "being held for another booking" for a free slot | P0 (slot-hold consistency) | `KyselyHoldRepository.create` first expires lapsed holds on the same technician's overlapping window (same transition as the sweep, database clock). Pinned by pgtest + real-Postgres race (8 claims over a lapsed hold → exactly one live hold). |
| D2 | The final `convert` UPDATE did not check `expires_at` against the DATABASE clock (only the app-clock pure check did) | P0 (valid OTP after hold expiry) | `AND expires_at > now()` in the guarded UPDATE; a zero-row update on a lapsed hold reports `expired` (`BOOKING_HOLD_EXPIRED`) via `repo.lapsed()`, never "already confirmed". Mutation check: original code fails both new tests. |
| D3 | **Real race (found by the new real-Postgres spec):** 8 simultaneous submissions of the CORRECT code left the session LOCKED — the 6th–8th found the 5-attempt budget used by in-flight correct attempts and called `lock()`, which beat the slow bcrypt compare that would have verified it. A double-tap or network retry after a few wrong tries could lock out a customer who typed the right code. | P0 | Only the attempt that spends the LAST slot on a WRONG code locks; an over-budget request re-reads (verified → "verified"); `markVerified` reports whether it won, and a correct code that lost to a lock does not record the phone as verified. Before: race spec failed (session locked); after: 3/3 runs pass. |
| D4 | The three "always re-verify" rules (group / deposit / high-value) were hidden — no caller ever passed booking risk to the guard, so they could never fire | P1 (guide §9) | `VerifiedBookingFlow.riskFor` reads, server-side from the booked services: catalog price vs the salon's new **high-value amount** (`high_value_threshold_cents`, migration 743, $1–$100,000, audited; empty = never fires) and the salon's deposit policy. A failed read throws (fail closed). Group: no remote path books more than one guest — the switch is shown with that note. |
| D5 | Six booking sources: only three were rendered | P1 (guide §2) | All six shown; kiosk / front desk / walk-in fixed OFF with the reason (the server refuses enabling them — `IN_SALON_NOT_VERIFIED`; staff exemptions never reach remote channels). |
| D6 | No KPIs, health check, live monitor, history, overlay | P1 (guide §4, §10–§13) | `booking-verification-center.ts` + controller (below) and the rebuilt screen. |
| D7 | Earlier Phone Numbers note: the old-number notice "is sent in Vietnamese" | — | Misreading: `customerMessageLanguage()` always answers `'en'`. The unreachable Vietnamese branch was removed. Customer-facing SMS in phone-change and booking-verification flows are English only (the booking code text is already English). |

## Effective policy semantics (unchanged resolver, now fed)

Super Admin (emergency disable → bookings continue unverified; require; block) → tenant switch (needs a connected AND
tested Twilio to turn on) → branch overrides → per-channel switches (remote: online, customer app, AI receptionist; in-salon:
never) → trust window (24 h shown; phone change / revoked phone always re-verifies; trust is per tenant, per account / per
device for the public link, never for kiosk / AI receptionist) → special rules (group / deposit / high-value, now fed) →
verify. Required + no working provider ⇒ the remote booking is refused, never let through.

## Hold / OTP state machine

Verification session: `pending → sent → verified | failed | locked | expired | canceled` (canonical statuses; the guide's
`challenge_pending` = `sent`). Hold: `held → converted | released | expired` (sweep, or the D1 clean-up on a new claim). A
booking is created only after `admit()` returns: the proof is claimed atomically for ONE booking, `assertNotHeldByOthers`
re-checks other sessions' holds, the channel's own conflict check runs, then `complete()` converts the hold (D2: the database
clock refuses a lapsed one). A code entered after the hold lapsed can only confirm a time that is still free.

## API (new; tenant and branch from the session; reads need `settings.view`)

| Route | Contract |
|---|---|
| `GET pos/booking-verification-center/summary` | six KPI cards, each with its definition; success % = verified ÷ requested (30 days) with numerator/denominator; `null` (Unknown) when nothing was requested |
| `GET …/health` | itemized checks `twilio_identity, verify_service, sender, policy, recent_errors, integration`, each `{state, message, evidence, nextAction, checkedAt}`; states `ready / needs_setup / pending_provider_action / degraded / failed / unknown`; non-destructive (no provider call, no purchase, no SMS); no SID / token in the answer |
| `GET …/live` | open codes + live holds, nearest expiry first, recent failures last; server `serverNow` for the countdown; masked phone only |
| `GET …/history` | `q` (name, E.164 phone → hash, last 4, verification / booking / customer / hold id, technician), `status` (pending, verified, failed, expired, cancelled, provider_error), `channel`, `branchId`, `basis` (requested, completed, hold_created, hold_expired, appointment), `preset` / `from` / `to` (salon-local inclusive days, DST-safe in Postgres), `page`, `pageSize` 10/20/50; `created_at DESC, id DESC`; exact total |
| `GET …/history/:id` | record + services + why (`policy_reason`, migration 743) + policy versions + masked provider reference + timeline; **audited** (`verification_record_viewed`) |
| `POST …/history/:id/resend` (`pos.booking.create`) | only an open, unexpired code whose customer's phone ON RECORD hashes to the session's number (staff can never redirect a code); goes through `BookingVerificationService.send` (tenant's own provider, cooldown, rate limits); audited |
| `PATCH pos/settings/booking-phone-verification` | now also `highValueThresholdCents` (integer cents or null) |

Error codes added: `BOOKING_VERIFICATION_NOT_FOUND`, `BOOKING_VERIFICATION_RESEND_REFUSED`, `BOOKING_VERIFICATION_RESEND_UNAVAILABLE`.

## Database (migration 743, additive)

`booking_verification_settings.high_value_threshold_cents` (nullable, CHECK 100..10,000,000) · `booking_verification_sessions.policy_reason`
(nullable) · index `idx_bvs_tenant_created (tenant_id, created_at DESC, id DESC)`. Applied twice (idempotent) to the local
`aps` template only. Rollback: both columns nullable and unread by older code — `DROP COLUMN` / `DROP INDEX` is safe. No
feature flag: every addition is read-only or additive; the D1–D3 fixes are safety fixes.

## UI

`POSBookingVerificationScreen.tsx` rebuilt in place: header (updated stamp, Refresh, Check Verification System) · six KPI
cards · two columns: Settings (main switch, six sources, re-verify frequency, the three rules + high-value amount, hold
minutes, all saved values) | SMS & system health · live monitor (countdown from server time; code and hold status separate)
· history (search, status / channel filters, Clear All, PeriodBar with the From/To month calendar and the date basis,
pager 1 2 3 + 10/20/50, newest first; safe view state in the URL — never the search text) · details overlay (Close,
Open customer, Open booking → the booking calendar, Resend). The existing "waiting for a code" override panel and the
30-day activity panel are kept. EN + VI staff labels (`ns/bookverify.{en,vi}.ts`, 110 keys each, parity checked).

## Tests (executed 31 Oct 2026, cloud workspace, PostgreSQL 16)

| Suite | Result |
|---|---|
| `booking-verification-center.pgtest` (new) | **14/14** — D1, D2, risk facts, flow wiring, high-value setting (validation, version, audit), KPIs (Unknown ≠ 0), health, live order, history search / paging / filters / date basis / DST-safe day, detail + audit + 404 cross-tenant, resend (open only, record-bound, audited) |
| `booking-verification-center.postgres-race` (new; CI race lane) | **3/3, three runs** — 12 wrong codes → exactly 5 attempts, locked once, hold released; 8 correct codes → one verified session, never locked (D3); 8 claims over a lapsed hold → one live hold |
| Mutation checks | original hold repository → 3 of the new pgtests fail; pre-fix `check()` → the correct-code race fails (session locked) |
| Regression | hold-core 27/27, hold.service 14/14, hold-deadlock 3/3, verification.service 19/19, guard 24/24, policy 29/29, session 6/6, settings 14/14, phone-center 13/13, customer-phone (8 suites) all pass, customer-notifications 18/18, old-number-notice 1/1 |
| Unchanged environment limits (fail identically on the unchanged HEAD) | `booking-verification.pgtest` 26/28, `booking-verification-proof.pgtest` 0/18, `booking-holds.pgtest` 2/6, `customer-booking-availability-holds.pgtest` 0/1 — query builder not available here |
| Browser E2E `interact.mjs bv-e2e bv` | **9/9** — saved values of every photographed control; KPIs = DB; Check Verification System (6 items); enable + $150 persist after reload; live monitor order / countdown / no code; history 30 rows pages 1 2 3, 50/page, name / last-4 / technician search, provider-error filter, Clear All, search not in URL; From/To calendar + basis; overlay why / timeline / resend counted / Close; Vietnamese with identical numbers; 1920×945, 1536×864, 1440×900, 1366×768, 1024×768 without sideways scroll. Screenshots: `tooling/catalog-one-screen/results/bv-e2e/` |
| Gates | 61 `check:*`: 51 pass via npm, 6 pass through the stand-in loader (sql, types-drift, sql-identifiers, db-ownership, unique-tenant-review, actor-stamp), **0 fail**, 4 can't run here (lint, boot, api-contract, strict-bodies-types). First run flagged silent-catch, as-any, error-text, response-exposure on this work — all fixed in code (one reviewed sensitive read recorded with its reason). |

## Status (guide §22 labels)

| Item | Status |
|---|---|
| Server enforcement: no verification-required booking without a same-session proof; holds atomic, expiry-safe, no double-booking | **Completed and Verified** (pgtest + real-Postgres races + mutation checks) |
| Correct-code lockout race (D3) | **Completed and Verified** |
| Special rules fed (deposit, high-value); high-value amount configurable + audited | **Completed and Verified**; group rule: **Not Implemented** — no remote path books more than one guest |
| KPIs, health check, live monitor, history (search, calendar, paging), overlay, resend | **Completed and Verified** (pgtest + browser E2E) |
| POS screen unit tests (`POSBookingVerificationScreen.test.tsx`, `.vi.test.tsx`, updated for the six sources / three rules) and POS / API type-check | **Implemented but Not Verified** — no vitest / jsdom / React types here; CI |
| Real Twilio Verify delivery, provider webhook authenticity, region permissions | **Blocked by External Setup** — sandbox / fake sender only; never the platform's Twilio |
| Physical ASUS 27″ touch test | **Blocked by External Setup** — browser viewports only, not equivalent to physical touch acceptance |
| Migration 743 on staging / production | **Blocked by External Setup** — owner approval |
| Open booking with the appointment preselected | **Not Implemented** — the Booking screen takes no deep-link parameters; the overlay opens the booking calendar |

## Owner decisions open

1. **Group bookings:** keep the switch (it has nothing to gate until a remote group-booking path exists), or hide it again?
2. **High-value amount:** leave it unset (rule dormant), or set a salon default (e.g. $150)?
3. **Resend from the POS** is allowed to `pos.booking.create` holders (Front Desk included, per the standing "Front Desk full communications control" decision) — confirm.
