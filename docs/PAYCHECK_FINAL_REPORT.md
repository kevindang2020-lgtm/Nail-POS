# Weekly Technician Paycheck, Cash Payout & Owner Approval — final engineering report (mandate §22)

Oct 21 2026. This report covers work that was built and run. It is not a proposal. The weekly paycheck **extends the one payroll**: the same `payroll_periods` / `payroll_lines` / `payroll_payouts`, `PayrollWorkflowService` and payroll screens. There is no second payroll app, table set or approval path. Every figure comes from PostgreSQL. The frontends only send choices: a split, a check number, a cash source, or a PIN.

---

## A. Existing payroll code found

| Layer | What exists (kept) |
|---|---|
| Tables | `payroll_periods` (115 / 589 / 610: draft → review → finalized → paid, version, preview / approval hash, validation), `payroll_lines` (one per technician per period; commission, retail, card / cash tips, guarantee, hourly, salary, bonus, deduction, adjustment, net, payable; locked by trigger in review / finalized / paid), `payroll_payouts` (611: method, status, idempotency key), `ticket_compensation_snapshots` (the earnings ledger), `compensation_adjustments`, `cash_drawer_movements` (084) |
| Services | `PayrollService` (the ONE build from sales), `PayrollWorkflowService` (validate / prepare / send back / approve / reopen / mark paid / record payout / payout status / export / adjustments / exceptions / inquiries / pay plans), `PayrollSelfService` (the technician's own reads), `CompensationService` (snapshots), `CashDrawerRepository`, `TechnicianClockPinService` |
| Controllers | `pos/payroll/*` (PayrollController), `owner/payroll*` (OwnerController approve / lock / reopen with PIN), `tech/payroll*` (TechController) |
| Workers | `CompensationRecoveryWorker`. There was no weekly pay-period worker. |
| Events | `PAYROLL_PERIOD_PREPARED / FINALIZED / PAID / REOPENED`, `PAYROLL_PAYOUT_RECORDED`, projected by `realtime-projection.consumer.ts` (`payrollClients`) |
| Screens | POS `POSPayrollScreen.tsx` (periods, review, exceptions, questions, pay plans); Owner `CommissionPayrollScreen.tsx` (+ Approval Center); Tech `TechPayrollScreen.tsx` |
| Tests | `payroll.vitest.spec`, `payroll-workflow.vitest.spec`, `payroll-lock.pgtest`, `payroll-wave2.postgres-race`, `payroll-paid-push`, the screen tests |

## B. Problems found

| Class | Problem | Resolution |
|---|---|---|
| P0 Financial integrity | **B-63**: cash tips handed to technicians each day were also counted in the payroll payable. Nothing subtracted them, so a salon that hands over cash tips daily paid them twice. | The statement's **already paid** = cash tips handed over (salon policy `cash_tips_already_paid`) + payouts already recorded on the week; approved payable = net − already paid. The default is off, so no salon's existing pay changes silently. |
| P1 Payout wiring | **B-64**: the Owner App's "Lock & Pay" marked a whole period **paid** with method `other`. No check number, no cash handoff, no technician confirmation. | A week paid through pay statements refuses the blanket mark-paid (`PAYROLL_PAY_THROUGH_PAYOUTS`). It is paid check by check and envelope by envelope. The week becomes PAID only when every required payout is complete. |
| P1 Approval flow | There was no manager submit → owner decision step. Anyone with `payroll.approve` approved the period directly. There was no return / reject with a note, no hold of one technician, and no separation of duties. | Submit, approve all or approve with holds, return, reject (with a required note), approve-held-later, and separation of duties (§16). |
| P1 Payout wiring | The generic payout-status route could move any payout. | It refuses a payout that has a check or cash lifecycle (`PAYROLL_PAY_THROUGH_PAYOUTS`). A paid payout can no longer change through it. |
| P2 Missing feature | No pay schedule, pay statements, statement numbers, payout plans (the 50 / 50 split), check lifecycle, cash lifecycle, drawer linkage, technician cash confirmation, paid / partially-paid status, weekly worker or paycheck reports. | All built (C–L). |
| P3 Cleanup | Stale compiled `packages/database` typings hid new columns from the module builds. This was a local artefact, not a product bug. | Rebuilt. `build-modules` builds packages from source. |
| P0 Tenant isolation / P0 Security | **None found** in the existing payroll. Every new table has RLS `tenant_isolation`, tenant-consistency triggers on every foreign key, and tenant-scoped queries. These are proven in R. | — |

## C. Final weekly payroll architecture

```
ticket_compensation_snapshots + compensation_adjustments  (earnings ledger — unchanged)
   → payroll_periods  (THE pay period; the weekly worker opens last week; draft = manager review)
   → payroll_lines    (THE calculation: PayrollService.buildFromSales — unchanged)
   → payroll_statements (NEW: an immutable snapshot per technician per week, PAY-YYYY-NNNNNN, already paid, approved payable, paid)
   → manager review   (split per technician, exceptions, submit → period review)
   → owner approval   (approve all / hold / return / reject — PayrollWorkflowService.approve + paycheck hooks in ONE transaction)
   → payroll_payout_plans + payroll_payout_instructions (NEW: how the payable is paid; Σ = payable exactly)
   → payroll_payouts  (THE payout transaction: one per instruction, with the check or cash lifecycle)
   → statement locked → issued → partially paid → paid;  period payout_status none → unpaid → partially_paid → paid; period → paid
```

How the existing period states map to the mandate's states: `draft` = OPEN / MANAGER_REVIEW; `review` + `submitted_at` = SUBMITTED_TO_OWNER; `finalized` = APPROVED + LOCKED; `paid` = PAID. An owner **reject** is a send-back with `owner_decision = 'rejected'` and a note. It is not a cancelled state, so a rejected week can be corrected and submitted again, never lost.

## D. Manager workflow (POS › Team › Payroll › Weekly paychecks)

1. **Open last week**, or let the weekly worker do it. **Calculate** runs the ONE build and then makes the statements, each with the salon's default split.
2. The table shows, per technician: earned, already paid, payable, check, cash, paid, unpaid, and the flags "owes more than earned", "custom split" and "split needs fixing". The drawer shows the full statement (commission, hourly / salary, card / cash tips, retail, bonus, top-up, adjustments, deductions, reversals) and the branch breakdown.
3. **Split per technician**: salon default, all check, all cash, custom percent, or custom dollars. A split that differs from the default needs a reason, and the owner sees it. A dollar split is checked on the screen and again on the server.
4. **Corrections** go through the existing adjustment ledger, then Recalculate. Line edits are never typed in.
5. **Submit to owner** is blocked by: no lines; statements out of step with the lines (`STATEMENTS_OUT_OF_DATE`); a negative payable (`NEGATIVE_PAYABLE`); a split ≠ payable (`PAYOUT_SPLIT_MISMATCH`); and every blocking validation issue of the existing workflow. Submitting ten times is one submission. A stale version is `PAYROLL_VERSION_CONFLICT`. After submission the split is frozen.

## E. Owner App workflow

- **Notification**: "Payroll approval required" (week, technicians, total, check / cash, number of custom splits) goes to the salon owner. The realtime refetch reaches the owner room.
- **Review**: Commission & Payroll shows the Weekly paychecks panel. It has the payable, check / cash and unpaid totals, last week for comparison, custom splits with the manager's reason, and the problems to look at. Each statement expands to its figures. A summary line covers all weeks (approved-unpaid, cash to hand over, checks to deliver, payout problems).
- **Approve all**, or tick technicians to **hold** and approve the rest. Both require the owner's **security PIN** (POS: password step-up). A held statement is approved later on its own, also with the PIN.
- **Return for changes** / **Reject** need a note. The manager is notified. The statements go back to manager review.
- **Lock**: approval locks each approved statement (DB immutability trigger) and materialises its payouts in the same transaction.
- **Separation of duties**: someone who is paid on the payroll, or who submitted it, cannot approve it (`PAYROLL_SELF_APPROVAL`). The exception is the salon's account owner (`tenants.owner_user_id`). This is decided by identity, never by a role name. A manager does not hold `payroll.approve`.

## F. 50 / 50 check / cash

`splitByBasisPoints(payable, parts)`: each share is `floor(payable × bp / 10000)`, and the remainder goes to the **primary method** (check by default; the salon can choose cash). Shares of $0 are dropped, so 100 / 0 is one payout. $100.00 → $50.00 / $50.00; $100.01 → $50.01 / $50.00; $0.01 → one $0.01 check. The salon's cash cap (`max_cash_bp`) lowers the cash share when needed, and cash-off means all check. `validateInstructions` refuses under / over allocation, disabled methods, cash over the cap, and manual splits when the salon allows only the default. On owner approval each instruction becomes one `payroll_payouts` row (idempotency key `stmt:{id}:instr:{seq}`), so approving N times creates them once.

## G. Manual split

The manager can set a **custom percent** (the percentages must total 100%, split exactly with the same remainder rule) or **custom dollars** (the amounts must equal the payable exactly; under- or over-allocation is refused). The salon policy is `manual_split_allowed`, the allowed methods and the cash cap. An override reason is required whenever the split differs from the default. It is stored on the plan (`differs_from_default`, `override_reason`), audited, highlighted to the owner, and counted in the week's "custom splits". If the payable changes before submission, a percent plan is re-split exactly. A dollar plan is kept as typed and shows UNDER / OVER until it is fixed; it is never silently rescaled.

## H. Check payout

`check_status`: planned → issued → delivered → cleared, with voided and returned branches.

- **Issue** records the check number. The number is unique per salon among live checks (`uq_payroll_payouts_check_number` → `CHECK_NUMBER_IN_USE`). A retry with the same number is the same issue.
- **Delivered** (handed to the technician) counts as PAID for payroll. **Cleared** records the bank clearing it, which is separate.
- **Void** (lost, misprinted) or **returned** by the bank requires a reason. The check stays in history. An optional **replacement** check (new number) references the original (`replaces_payout_id`). Without a replacement the amount is unpaid again, and "Pay it by check / in cash" re-plans the remainder, bounded by what is still owed.

## I. Cash payout

`cash_status`: planned → ready_for_handoff → handed_off → acknowledged, with disputed and canceled branches.

- **Prepare** records the source: register drawer, safe, bank withdrawal or another recorded source. From a **register drawer** it writes a `PAYROLL_CASH_PAYOUT` "out" movement linked to the payout (`source_type`, `source_id`) in the same transaction, idempotent on `payroll_cash:{payoutId}`. The drawer's expected cash drops by that amount. If the drawer holds less than the amount, the result is `INSUFFICIENT_CASH`; it never goes negative.
- **Hand over** records the manager and the device.
- **Technician acknowledgment** happens in the Tech App ("I received it") or with the technician's 4-digit clock PIN on the manager's POS. The PIN keeps its own lockout. Retries count as one acknowledgment.
- **Dispute** ("Something is wrong", with a reason) comes from the technician, and the owner is notified. The manager hands over again or cancels.
- **Cancel** is allowed only for planned, prepared or disputed cash. It voids the drawer movement (kept, never deleted) and the payout is canceled, never paid.
- **Paid** means acknowledged, or handed off when the salon chose `cash_paid_on = handed_off`. Prepared cash is not paid. Cash is never off-book: it appears on the statement, the reports, the drawer and the audit trail.

## J. Multi-branch payroll

The weekly period is **salon-wide**. A technician gets **one** statement per week, enforced by `uq_payroll_statements_live` (tenant, period, technician), whichever branches they worked at. The statement carries a **branch breakdown** (service earnings, tips and services per branch) built from the compensation snapshots, so there is never a second paycheck per branch. Running payroll (`payroll.manage`) and approving it (`payroll.approve`) are salon-wide keys. Someone who may only **view** payroll sees only technicians who work at their branch (home branch or earnings there that week), and only their branch's contribution detail.

## K. Pay statements

`payroll_statements` holds the snapshot of every component, gross, line payable, already paid, approved payable, paid, the line hash it was made from, and the branch breakdown. **Numbering**: `PAY-YYYY-NNNNNN` from a per-salon, per-year counter (`payroll_statement_counters`, atomic upsert), unique per salon. Recalculating a draft keeps the number. **Immutability**: the database trigger `payroll_statements_immutable` refuses any change to the figures once a statement is approved / locked / issued / partially paid / paid, and refuses DELETE outright. Only the paid amount, the status and the stamps move. Reopening an approved week (allowed only while no payout is in motion) **voids** its statements, keeps them, and cancels their planned payouts. The next submission issues new numbers.

## L. Reports

`GET /pos/payroll/paychecks/reports?range=week|month|ytd|custom` returns:

- totals by component;
- payable / paid / unpaid **by technician**;
- service earnings and tips **by branch** (where the work was done);
- committed / paid **by payout method**;
- the **check register** (number, status, void reason);
- the **cash payout report** (source, status);
- the **accounting** block.

The accounting block treats payroll expense as the statements' line payable, counted **once**. Check, cash, other, already-received and unpaid are how that one liability was settled, and `reconciles` proves they sum to it. Check and cash are never added as a second expense. The owner dashboard summary (`/owner/payroll/paychecks/summary`) shows weeks waiting for approval, approved-unpaid, check / cash totals, cash waiting to be handed over, checks waiting for delivery, and payouts with a problem.

## M. Permissions & audit

| Key | Who (default) | Gates |
|---|---|---|
| `payroll.view` (`pos.payroll.view`) | Owner, Manager | the week, statements, reports, summary |
| `payroll.manage` (`pos.payroll.manage`) | Owner, Manager | open week, calculate, default split, a technician's split, submit |
| `payroll.approve` | Owner | approve (step-up / PIN), approve held, return, reject, pay schedule & policy |
| `payroll.issue_check` **(new)** | Owner, Manager | issue / deliver / clear / void / replace a check; re-plan unpaid by check |
| `payroll.cash_handoff` **(new)** | Owner, Manager | prepare cash, hand over, the technician's PIN confirmation, re-hand / cancel; re-plan unpaid in cash |
| `tech.payroll.view` | Technician | own statements, confirm / dispute own cash |

A receptionist holds none of these. Step-up applies to approve, approve-held, schedule, check issue / deliver / void, cash prepare / resolve and adding a payout. **Audited** (module `payroll`): `schedule.saved`, `week.opened`, `payout_plan.changed` (with the reason), `payout_plan.default_applied`, `period.submitted`, `statement.approved`, `check.issued / delivered / cleared / voided / returned`, `cash.prepared / handed_off / acknowledged / disputed / canceled / rehandoff`, `payout.added`, plus the existing `period.approved / sent_back / reopened`.

## N. Database — migration `673_payroll_paychecks.sql`

- **New tables**: `payroll_schedules`, `payroll_statement_counters`, `payroll_statements`, `payroll_payout_plans`, `payroll_payout_instructions`.
- **`payroll_periods` adds**: submitted_by / at, owner_decision (approved | returned | rejected), owner_note, owner_decided_by / at, payout_status (none | unpaid | partially_paid | paid), schedule_generated.
- **`payroll_payouts` adds**: methods ach / external_transfer / payroll_provider, statement_id, instruction_id, check_* (number, status, issued / delivered / cleared / voided, void reason, replaces_payout_id), cash_* (source, status, register, prepared / handed-off / acknowledged stamps, ack method, dispute reason), drawer_movement_id, device_id, version, plus a lifecycle shape CHECK.
- **`cash_drawer_movements` adds**: source_type, source_id, idempotency_key.

Constraints and indexes:

- money CHECKs: `paid ≤ approved payable`, amounts > 0;
- `uq_payroll_statements_live`, `uq_payroll_payout_plans_live`, unique statement number, `uq_payroll_payouts_check_number` (live checks), `uq_cash_drawer_movements_idem`, `uq_payroll_periods_schedule_week`;
- every unique index includes `tenant_id`;
- tenant-consistency triggers on every foreign key;
- RLS `tenant_isolation` on every new table;
- the statement immutability trigger.

The migration is additive (expand only) and passes `check:migration-safety`. A fresh database migrates through 673 (613 applied).

## O. APIs (all new; nothing removed)

POS `/pos/payroll/paychecks/…`:

- schedule: `GET schedule`, `POST schedule`
- weeks: `POST open-week`, `GET periods/:id`, `POST periods/:id/calculate | apply-default | submit | approve | return | reject`
- summary and reports: `GET summary`, `GET reports`
- statements: `GET statements/:statementId`, `POST statements/:statementId/payout-plan | approve | payouts`
- checks: `POST payouts/:payoutId/check/issue | deliver | clear | void`
- cash: `POST payouts/:payoutId/cash/prepare | handoff | acknowledge-pin | resolve`

Owner `/owner/payroll/paychecks/…`:

- `GET summary`, `GET periods/:id`
- `POST periods/:id/approve` (PIN + holds) `| return | reject`
- `POST statements/:statementId/approve` (PIN)

Tech `/tech/payroll/…`:

- `GET statements`, `GET statements/:statementId`
- `POST cash-payouts/:payoutId/acknowledge` (Idempotency-Key)
- `POST cash-payouts/:payoutId/dispute`

**Contracts**: `packages/api-contracts/src/tenant/payroll-paychecks.ts`. Every handler is typed with it. Bodies are validated (`PAYCHECK_*_BODY`, `OWNER_PAYCHECK_*_BODY`, `T_CASH_DISPUTE_BODY`); amounts, statuses and payables are `x-forbidden`. **Error codes** (registered): `PAYROLL_PAY_THROUGH_PAYOUTS`, `PAYOUT_PLAN_INVALID`, `PAYROLL_SUBMIT_BLOCKED`, `PAYROLL_SELF_APPROVAL`, `CHECK_NUMBER_IN_USE`, `INSUFFICIENT_CASH`, `PAYOUT_INVALID_STATE`, `PIN_INVALID`, `STATEMENT_NOT_FOUND`, `NO_LINES`, `STATEMENTS_OUT_OF_DATE`, `OVERRIDE_REASON_REQUIRED`, alongside the existing `PAYROLL_VERSION_CONFLICT` and `PAYROLL_PERIOD_NOT_READY`.

## P. Events / workers / realtime / notifications

- **Events**: every one below is written to the outbox in the same transaction as the write it describes, and all are registered in the event catalog.
  - Week: `PAYROLL_PERIOD_OPENED`, `PAYROLL_CALCULATED`, `PAYROLL_SUBMITTED_TO_OWNER`, `PAYROLL_RETURNED`, `PAYROLL_REJECTED`, `PAYROLL_PARTIALLY_PAID`, plus the existing `PAYROLL_PERIOD_FINALIZED / PAID`.
  - Statements: `PAY_STATEMENT_CREATED`, `PAYOUT_PLANNED`.
  - Checks: `PAYOUT_CHECK_ISSUED / DELIVERED / VOIDED`.
  - Cash: `PAYOUT_CASH_READY / HANDED_OFF / ACKNOWLEDGED / DISPUTED`, `PAYOUT_CANCELED`.
  - Drawer: the existing `CASH_DRAWER_MOVEMENT_RECORDED / VOIDED`.
- **Realtime**: `paycheckClients` projects each event to the salon (owner room plus the branch-less staff room) and to every technician concerned (their own room). Only ids and the action are sent, and screens refetch. The Tech App panel refetches on them.
- **Worker**: `PayrollWeeklyScheduler` runs hourly. It is off unless `PAYROLL_WEEKLY_PREP_ENABLED=1` and `runsBackgroundJob('standard')`, so it never runs in dev or CI. For each salon with `auto_prepare` it opens and calculates the last completed week in the salon's own time zone, as `systemContext('payroll-weekly')`. It is idempotent on the unique schedule-week index and never submits or approves. One salon's failure is logged and the rest continue.
- **Notifications** are best-effort after commit and logged when not sent:
  - "Payroll approval required" → owner
  - "Payroll returned / rejected" → the submitter
  - "Your pay statement is ready" → each approved technician
  - "Your cash pay is ready" → the technician
  - "Cash payout disputed" → owner
- **Retry / idempotency**:
  - submit and approve are row-locked, versioned and repeat-safe;
  - payouts use `stmt:{id}:instr:{seq}`; replacements use `replace:{payoutId}`;
  - the drawer movement uses `payroll_cash:{payoutId}`;
  - a check issue with the same number, a cash acknowledgment, a dispute and a cancel are each the same action when repeated.

## Q. Files changed

**New**
- `apps/api/db/migrations/673_payroll_paychecks.sql`
- `modules/workforce/src/payroll/payroll-paycheck.ts` (pure rules + state machines)
- `modules/workforce/src/payroll/payroll-paycheck.service.ts`
- `modules/workforce/src/payroll/payroll-weekly.scheduler.ts`
- `packages/api-contracts/src/tenant/payroll-paychecks.ts`
- `apps/api/src/payroll/paycheck-wiring.ts` (drawer binding)
- `apps/pos-web/src/screens/POSPaycheckTab.tsx`
- `apps/owner-web/src/screens/OwnerPaycheckPanel.tsx`
- `apps/tech-web/src/screens/TechPayStatementsPanel.tsx`
- Tests:
  - `modules/workforce/src/payroll/payroll-paycheck.vitest.spec.ts`
  - `modules/workforce/src/payroll/payroll-paycheck.pgtest.vitest.spec.ts`
  - `modules/workforce/src/payroll/payroll-paycheck.postgres-race.vitest.spec.ts`
  - `apps/api/src/payroll/paycheck-wiring.pgtest.vitest.spec.ts`
  - `POSPaycheckTab.test.tsx`
  - `OwnerPaycheckPanel.test.tsx`
  - `TechPayStatementsPanel.test.tsx`

**Changed**
- workforce:
  - `payroll-workflow.service.ts` (hooks; submit-without-rebuild; owner return / reject; refuse blanket pay / generic status on tracked payouts; payout-changed hook)
  - `payroll-workflow.ts` (error codes)
  - `payroll.dto.ts` (a delivered check may be voided → canceled)
  - `payroll.controller.ts` (routes)
  - `payroll.module.ts` (service, worker, PIN, push)
  - `request-schemas.ts`
  - `index.ts`
  - `package.json` / `tsconfig.json` (tenant-context)
- checkout:
  - `cash-drawer.repository.ts` (`payrollWithdraw` / `payrollReverse` / `availableNow`)
  - `cash-drawer.module.ts` (exports the repository)
- queue: `tech.controller.ts`, `tech.service.ts`, `tech.module.ts`, `request-schemas.ts`
- analytics: `owner.controller.ts`, `owner.service.ts` (`assertPayrollPin`), `request-schemas.ts`
- packages:
  - `database/kysely.types.ts`
  - `events/event-contract.ts`
  - `api-contracts/errors.ts`
  - `api-contracts/tenant/index.ts`
  - `permissions/rbac.ts`
  - `permissions/permission-registry.ts`
- apps:
  - `api/app.module.ts`
  - `api/.../realtime-projection.consumer.ts`
  - POS `posPayrollApi.ts`, `POSPayrollScreen.tsx`, `i18n/catalog.{en,vi}.ts` (+148 Vietnamese strings)
  - Owner `ownerApi.ts`, `CommissionPayrollScreen.tsx`
  - Tech `techApi.ts`, `TechPayrollScreen.tsx` (+ test mock)
- Generated / allowlists:
  - state vocabularies, db ownership, actor columns, `PERMISSIONS.md`, role matrix, openapi manifest, `EVENT_CATALOG.md`
  - list-queries allowlist (the report is one aggregate)
  - mass-assignment review (`setPayout` patch literals)
  - `package-lock.json`

## R. Tests

Run on Oct 21 2026 at the head of this milestone. Every line is PASS / FAIL / BLOCKED_EXTERNAL as it actually ran.

| Suite | Result |
|---|---|
| Paycheck unit tests (`payroll-paycheck.vitest.spec`): $100.00, $100.01, $0.01, 25/75, 10/90, 100/0, 0/100, sweep of amounts × splits, manual % / $, under / over, policy, already-paid cash tips, negative payable, numbering, paid / partial, check / cash states, immutability, weekly window | **PASS** 24 / 24 |
| Paycheck pgtest (PGlite, all migrations): end-to-end week, manual split, receptionist / other-salon refusals, submit ×10 → 1, return / resubmit / approve with hold, approve ×N → one set of payouts, DB immutability, blanket mark-paid refused, check issue retry + duplicate number, insufficient drawer, prepare retry → one withdrawal, PIN acknowledgment (wrong PIN refused, retry → 1), handoff → dispute → cancel (never paid, back in drawer) → re-plan by check, void + replacement, partially paid → paid → week PAID, held statement approved later, technician privacy (no manager note, not another technician), reports reconcile, stale version → conflict, split frozen after submit, branch-scoped viewer, generic status route refused | **PASS** 21 / 21 |
| Real-Postgres race (`PG_RACE_URL`, pool of 30): 10 simultaneous submits → 1 event; 10 approvals → 1 approval, 1 payout per instruction; 10 check issues → 1; 10 cash acknowledgments → 1; week paid once | **PASS** 3 / 3 |
| API drawer binding pgtest: withdrawal once per key, expected cash drops, cancel puts it back (movement kept), rolls back with its transaction | **PASS** 2 / 2 |
| Screens: POS Weekly paychecks (5), Owner App panel (5), Tech App statements (4), existing payroll screens (POS 10, Owner 10, Tech 3) | **PASS** |
| Module lanes: workforce 991 (1 fail → fixed: the payout state test now encodes the one allowed paid → canceled for a voided delivered check; rerun 85 / 85 payroll), queue 689, analytics 279, checkout 811 | **PASS** (after the fix) |
| App lanes: POS 1,392 · Owner 348 · Tech 187 | **PASS** |
| API lane (3 shards): 1,100 · 955 · 982 — 3 failures, all inventory gates for the new code (push copy review, GET handler names, IDOR fixtures); each fixed (push copy now carries no amounts or free text) and rerun | **PASS** after fixes (shards 1 and 3 were not rerun end-to-end — the container restarted twice mid-run; the three files were rerun alone and pass) |
| `ci:gates` | **PASS** — all 51 gates + 16 audits |
| Fresh database migration | **PASS** — 613 applied through 673 |
| BLOCKED_EXTERNAL | none for this mandate. ACH / direct-deposit / payroll-provider payouts are recorded methods; no provider is connected (none is faked) |

## S. Financial invariants (each enforced in code AND the database, and proven in R)

| Invariant | Where |
|---|---|
| Earnings reconcile: the statement is a snapshot of the line; a submit with a changed line is refused | `line_hash` check at submit (`STATEMENTS_OUT_OF_DATE`); immutability trigger after approval |
| Already paid reconciles | approved payable = net − (handed-over cash tips by policy + payouts already recorded on the week); never negative (review required) |
| Payout plan = payable | `validateInstructions` (UNDER / OVER_ALLOCATED) at every save and again at submit (`PAYOUT_SPLIT_MISMATCH`) |
| paid + unpaid = payable | unpaid is derived (`approved − paid`); `paid_cents ≤ approved_payable_cents` CHECK; `PAYOUT_EXCEEDS_PAYABLE` on recompute |
| Payout methods = paid | statement `paid_cents` = Σ payouts with `status = paid`, recomputed in the payout's own transaction; report `byMethod` sums the same rows |
| No double pay | one live statement per technician per week; one payout per instruction (idempotency key); one drawer movement per payout; a void returns the amount to unpaid, never adds; a delivered check counts once; the blanket "mark paid" is refused on these weeks |
| Accounting counted once | report `accounting.reconciles`: line payable = check + cash + other + already received + unpaid |

## T. Build matrix

| Target | Build / typecheck | Tests |
|---|---|---|
| API (`apps/api`) | PASS | PASS (see R) |
| Modules (workforce, queue, analytics, checkout + all 26 via build-modules) | PASS | PASS |
| POS (`pos-web`) | PASS | 1,392 PASS |
| Owner App (`owner-web`) | PASS | 348 PASS |
| Technician App (`tech-web`) | PASS | 187 PASS |
| Workers (weekly scheduler — off by default; outbox / realtime projection) | PASS | covered by the pgtests |
| Realtime (projection consumer) | PASS | gate `check:realtime-catalog` PASS |
| Migrations | PASS (fresh DB, 613) | — |
| Unit / integration / concurrency / security | — | PASS (R) |
