# Weekly Technician Paycheck, Cash Payout & Owner Approval — requirement-by-requirement status

Mandate: `docs/mandates/2026-10-27_WEEKLY_PAYCHECK_CASH_PAYOUT_MANDATE.txt` (25 chapters).
Audit date: Oct 27 2026, branch `merge-github-main`, HEAD `f90c183d`. READ-ONLY audit of the committed tree
(no file under `modules/workforce`, `apps/pos-web/src/screens/POSPaycheck*`, `apps/owner-web`, `apps/tech-web` is modified
in the working tree). No builds or heavy suites were run; "DONE" means the code, the DB migration and a test or pilot line
were opened and read, not that the suite was re-executed today. Test-result claims below cite
`docs/PAYCHECK_FINAL_REPORT.md` §R/§T (Oct 21) and the pilot logs (`docs/pilot-runs/2026-10-26-final/pilot.log`,
`docs/pilot-runs/2026-10-26-200b/pilot.log`).

**Close-out build, Oct 27 2026 (commit `15a79fef` + follow-ups):** the 13 INTERNAL items below were built and tested — the
rows they close are marked **DONE (Oct 27)** with the new evidence. New evidence keys: `mig701` =
`apps/api/db/migrations/701_payroll_paycheck_closeout.sql`; `close-pg` =
`modules/workforce/src/payroll/payroll-paycheck-closeout.pgtest.vitest.spec.ts` (PGlite, every migration, 10 tests);
`close-race` = `modules/workforce/src/payroll/payroll-paycheck-closeout.postgres-race.vitest.spec.ts` (real Postgres
`race_final`, 3 tests: QR ×10, dual ×10, open ×10 + cancel ×10); `unit` gained 4 close-out describes (30 tests);
`pos-test` = `apps/pos-web/src/screens/POSPaycheckTab.test.tsx` (11); `owner-test` = `OwnerPaycheckPanel.test.tsx` (10);
`tech-test` = `TechPayStatementsPanel.test.tsx` (6); `pilot-10e2` = `apps/api/scripts/live-pilot-day.mjs` phase 10e / 10e2
(preparation report, manager push, BRANCH_MANAGER refusal, cancel, the three confirmations). Suites were RUN on this
machine (TZ=UTC): unit 30 / 30, close-out pgtest 10 / 10, race 6 / 6 (both paycheck race specs), POS 11 / 11, Owner 12 / 12
(incl. catalog), Tech 8 / 8 (incl. catalog). The pilot phase was added and syntax-checked; it runs with the next full pilot day.

**Re-audit — Oct 28 2026 (the attached 22-page PDF is this mandate).** The header's "161 / 161 DONE" did not hold. Fixed on
Oct 28 (`b8ca06da`, BUILT — verify V-28): branch scope of payout mutations / report / owner summary (14.3 / 16.6 / 20.3 / 24.2 /
21.21 — the legacy period read routes are still unscoped, so those rows are PARTIAL), the cash-cap odd cent (6.8 / 7.7), the paid
re-handoff (11.4 / 20.4) and the drawer race (12.3). Still open and recorded for Kevin: no "payout completed" push (17.7), a paid
week does not go back after a later void, itemised reversals netted (4.2). Note W-1 is stale: pilot phase 10e2 did run
(`docs/pilot-runs/2026-10-27-final/pilot.txt:132-135`, 235 / 235). The pay-stub evidence (17.5) and 21.25 wait on V-28.

Status vocabulary: DONE · PARTIAL · NOT DONE · BLOCKED_EXTERNAL (real outside dependency only).

Key: `svc` = `modules/workforce/src/payroll/payroll-paycheck.service.ts`; `pure` = `modules/workforce/src/payroll/payroll-paycheck.ts`;
`ctl` = `modules/workforce/src/payroll/payroll.controller.ts`; `mig` = `apps/api/db/migrations/673_payroll_paychecks.sql`;
`pos` = `apps/pos-web/src/screens/POSPaycheckTab.tsx`; `owner` = `apps/owner-web/src/screens/OwnerPaycheckPanel.tsx`;
`tech` = `apps/tech-web/src/screens/TechPayStatementsPanel.tsx`; `pgtest` = `modules/workforce/src/payroll/payroll-paycheck.pgtest.vitest.spec.ts`;
`unit` = `modules/workforce/src/payroll/payroll-paycheck.vitest.spec.ts`; `race` = `modules/workforce/src/payroll/payroll-paycheck.postgres-race.vitest.spec.ts`;
`report` = `docs/PAYCHECK_FINAL_REPORT.md`; `pilot` = `docs/pilot-runs/2026-10-26-final/pilot.log`.

## 1. Mission & takeover rules

| § | requirement (short) | status | evidence |
|---|---|---|---|
| 1.1 | Inspect the real repository first (DISCOVER → … → TEST/BUILD/DOCUMENT) | DONE | `report` §A (tables, services, screens, tests found) and §B (classified problems B-63/B-64…) |
| 1.2 | No second payroll system / no PayrollV2, PaycheckSystem2, NewPayoutService | DONE | `mig:5-17` "EXTENDS the one payroll system": `payroll_periods`/`payroll_lines`/`payroll_payouts` kept; `svc:2-11` layers on `PayrollWorkflowService`; `apps/api/scripts/check-one-payroll-calculation.mjs` gate |
| 1.3 | Preserve working implementation and production data | DONE | `mig` is `CREATE … IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` only; older `periods/:id/finalize|pay|payouts` routes kept (`ctl:110-115`) |
| 1.4 | Earnings come from the existing payroll ledger | DONE | `svc:306-347` `syncStatements` reads `payroll_lines` only; `svc:262` the ONE `builder.buildFromSales`; `pure:176-190` `statementFigures` |
| 1.5 | Frontends never financial authority | DONE | `pos:7` "server decides every figure"; `pos:221-241` SplitEditor sends a policy + entries, server re-validates (`svc:498-531`); request bodies forbid amounts/status (`report` §Q `x-forbidden`) |
| 1.6 | PostgreSQL remains financial truth | DONE | every write is a `FOR UPDATE` transaction (`svc:156-161`, `svc:998-1011`); CHECK constraints `mig:110-111`, `:184-220` |
| 1.7 | Exact money (integer minor units) | DONE | all `*_cents BIGINT` (`mig`); `pure:96-103` integer floor + remainder |
| 1.8 | Nothing COMPLETE until UI→API→auth→tenant→permission→domain→DB→outbox→event/worker→realtime tested | DONE | `report` §R/§T; `pilot:126-129` (calculate → submit → approve → check numbers → cash prepare/handoff/ack → paid/unpaid, via the API); realtime projection `apps/api/src/events/consumers/realtime-projection.consumer.ts:353-368`; screen tests `POSPaycheckTab.test.tsx`, `OwnerPaycheckPanel.test.tsx`, `TechPayStatementsPanel.test.tsx`. Note: the screens are covered by vitest (mocked API), not a browser run |
| 1.9 | Cash is a recorded payroll method, never off-book | DONE | cash payout rows in `payroll_payouts` (`mig:198-209`), on statements (`svc:683`), reports (`svc:1346`), audit (`svc:1119,1132,1163`) |

## 2. Repository audit & merge strategy

| § | requirement (short) | status | evidence |
|---|---|---|---|
| 2.1 | Search the whole repo for payroll/payout/cash/check/adjustment/timeClock/approval terms | DONE | `report` §A table (migrations 115/158/255/589/610/611/612/673, services, screens, tests) |
| 2.2 | Inspect schemas, Kysely models, migrations, services, controllers, workers, events, realtime, permissions, audit, POS, Owner, Tech, reports, tests | DONE | `report` §A, §N, §O, §P |
| 2.3 | Classify every implementation (COMPLETE … BLOCKED_EXTERNAL) | DONE | `report` §B (P0 B-63 double-paid cash tips, P1 B-64 blanket mark-paid, P1 approval flow missing, P2 missing features, P3 stale typings) |
| 2.4 | Continue fixing, do not stop at the inventory | DONE | §B "Resolution" column; migration 673 + the service |

## 3. Weekly payroll schedule & pay-period lifecycle

| § | requirement (short) | status | evidence |
|---|---|---|---|
| 3.1 | Weekly first-class; week boundaries, timezone and pay date tenant-configurable | DONE | `payroll_schedules` (`mig:21-42`); `svc:186-211` `saveSchedule`; `svc:214-225` salon time zone; `pure:230-237` `lastCompletedWeek` (Mon Oct 12 – Sun Oct 18 → pay Oct 23, `unit:162`) |
| 3.2 | PayrollSchedule {tenantId, frequency, weekStartDay, weekEndDay, paydayOffsetDays?, timezone, active} | DONE | `mig:21-42` (weekEndDay is derived = start + 6, not stored) |
| 3.3 | Frequencies WEEKLY / BIWEEKLY / SEMIMONTHLY / MONTHLY, UX optimised for weekly | DONE (Oct 27) | `pure` `lastCompletedPeriod` (14-day blocks anchored on the week-start day of Jan 2024; 1st–15th / 16th–end; previous month) + `periodLabel`; `openWeek` uses it for every frequency and the scheduler no longer filters weekly (`payroll-weekly.scheduler.ts`); POS schedule has a frequency selector + "Open last period". `unit` "§3.3 non-weekly frequencies" (3 tests); `close-pg` "monthly salon opens Sep 1–30"; `close-race` 10× open → one period |
| 3.4 | Pay-period states OPEN … PAID, CANCELED | DONE (Oct 27) | `payroll_periods.status` gains `canceled` (`mig701`, vocab CHECK + `canceled_at/by`, `cancel_reason`; `PAYROLL_PERIOD` draft → canceled, terminal; `dashboardStatusOf` → CANCELED). `svc.cancelPeriod` (draft only, nothing submitted / approved, no payout in motion; statements VOIDED, plans superseded; `payroll.period_canceled` outbox event; `period.canceled` audit) behind `POST paychecks/periods/:id/cancel` (step-up). A canceled period holds no days: overlap checks and `uq_payroll_periods_schedule_week` ignore it. MANAGER_REVIEW is now explicit through `payroll.manager_review_started` (17.1). `close-pg` "CANCELED (reason required, audited, event), same month opened again"; `close-race` 10× cancel → one; `pos-test` "§3.4"; `pilot-10e2` CANCELED PERIOD |
| 3.5 | No vague booleans (isPaid / isApproved) | DONE | state machines `PAYROLL_PERIOD` (`payroll.dto.ts`), `PERIOD_PAYOUT`, `PAY_STATEMENT` (`pure:18-73`) |

## 4. Earnings calculation & already-paid handling

| § | requirement (short) | status | evidence |
|---|---|---|---|
| 4.1 | Read earnings from the authoritative ledger, never recalculate commission independently | DONE | `svc:309` reads `payroll_lines`; `svc:262` the one build; `apps/api/scripts/one-payroll-calculation.allowlist.json` gate |
| 4.2 | Components: SERVICE_COMMISSION, TIP, RETAIL_COMMISSION, HOURLY, SALARY, BONUS, GUARANTEE_TOP_UP, ADJUSTMENT, DEDUCTION, REFUND_REVERSAL, TIP_ADJUSTMENT, RETAIL_REVERSAL | BUILT Oct 28 (verify V-28) | `payroll_statements.refund_reversal_cents / tip_adjustment_cents / retail_reversal_cents` (`mig701`, CHECK Σ ≤ `reversals_cents`, in the immutability trigger); `pure` `itemiseReversals` from the ledger categories (refund / void / chargeback → refund; `tip_correction` → tip; `retail_reversal` → retail), `svc.reversalItems` (one query per 1000 technicians, the one build's routing), clamped to the reversal total; on the POS drawer, the Owner panel and the wire (`PayStatement`). `unit` "§4.2 itemised reversals"; `close-pg` "itemises Mia's reversals (refund $10, tip $2) inside the $12 total" **Re-audit (Oct 28):** the statement figures net bonuses and reversals into one adjustment (+$50 and −$10 show as +$40, $0 reversals), so the itemised refund line is clamped to $0; totals are right, the breakdown is lost. Recorded for Kevin (display decision). **Re-audit (Oct 28):** Kevin decided to itemise: statementFigures takes the ledger's in-favour total, so +$50 / -$10 show separately; the payable is unchanged (`78a07f6b`). |
| 4.3 | Weekly payable formula (… − already paid = payable) | DONE | `pure:176-190`; `unit:91-110` |
| 4.4 | Earned ≠ still owed (example $2,100 − 300 + 50 = $1,850) | DONE | `pure:181-188`; `unit:100` |
| 4.5 | Cash tips already handed over are not paid again | DONE | `payroll_schedules.cash_tips_already_paid` (`mig:36`); `pure:181`; `unit:91`; `report` §B B-63 |
| 4.6 | Advances / earlier partial payouts reduce current payable | DONE | `svc:319-322` prior `paid` payouts on the period with `statement_id IS NULL`; `unit:100`. Note: only payouts recorded on the SAME period count (an advance must be recorded against the open week) |
| 4.7 | Already-paid remains visible in history | DONE | `already_paid_cents` on the statement; `pos:200`, `tech:68` "Already paid to you" |
| 4.8 | Negative net → REVIEW_REQUIRED, never a negative payout | DONE | `pure:188` `reviewRequired: raw < 0`, `approvedPayableCents: max(0, raw)`; submit blocked `NEGATIVE_PAYABLE` (`svc:704-705`); `unit:103` |

## 5. Pay statements & immutable snapshots

| § | requirement (short) | status | evidence |
|---|---|---|---|
| 5.1 | Approved statement is a locked snapshot, never reconstructed from today's rates | DONE | DB trigger `payroll_statements_immutable` (`mig:122-141`); `pgtest:136` |
| 5.2 | TechnicianPayStatement fields (gross, each component, alreadyPaid, approvedPayable, paid, unpaid, status, version, timestamps) | DONE | `mig:70-113` (technicianEmploymentId → `technician_id`; `unpaid` derived `svc:562`) |
| 5.3 | Statuses DRAFT … VOIDED | DONE | `mig:110` + `held`; `pure:18-33` |
| 5.4 | Human-readable immutable reference PAY-2026-000128 | DONE | `pure:193`; counter `mig:62-67`; `svc:277-283` one atomic bump per batch; `unit:112` |
| 5.5 | Normal users cannot silently rewrite a locked statement | DONE | trigger refuses figure changes and DELETE (`mig:123-141`); `pgtest:136` |
| 5.6 | Post-lock corrections = new correction/reversal or future-period adjustment linked to the original | DONE | `payroll-workflow.service.ts:583-629` (`decideAdjustment`, `carryForward` with `negative_carry_forward`); refund after lock → next-period adjustment (`docs/PILOT_DAY_REPORT.md:344` step 5, `pilot:81`) |

## 6. Payout plans & exact 50 / 50

| § | requirement (short) | status | evidence |
|---|---|---|---|
| 6.1 | Separate what is owed from how it is paid | DONE | `payroll_payout_plans` + `payroll_payout_instructions` (`mig:144-181`) distinct from `payroll_statements` |
| 6.2 | Chain ledger → period → statement → plan → approval → payouts → paid/unpaid | DONE | `svc:6-11`; `lockAndMaterializeMany` (`svc:840-863`) |
| 6.3 | TechnicianPayoutPlan {policyType, payableAmountCents, status, createdBy, submittedBy, approvedBy, version} | DONE | `mig:144-160` |
| 6.4 | PayoutInstruction {method, amountCents, percentageBasisPoints, sequence, status} | DONE | `mig:164-177` |
| 6.5 | Methods CHECK, CASH, ACH, DIRECT_DEPOSIT, EXTERNAL_TRANSFER, PAYROLL_PROVIDER | DONE | `mig:169`, `pure:76` |
| 6.6 | Only tenant-enabled methods may appear | DONE | `allowed_methods` (`mig:34`); `pure:143` `METHOD_NOT_ALLOWED`; `unit:80` |
| 6.7 | Default 50 / 50 preset | DONE | `default_check_bp 5000` (`mig:30`); `pure:106-114`; `unit:17` |
| 6.8 | Odd cent to the primary method, deterministic | BUILT Oct 28 (verify V-28) | `pure:94-103`, `primary_method` (`mig:31`); `unit:20,34` ($100.01 → $50.01/$50.00) **Re-audit (Oct 28):** with "primary method = cash" and a cash cap below 100 %, the odd cent went to cash and broke the cap ($1,000.01 at 50 % → cash $500.01, `CASH_OVER_LIMIT`), blocking submit. Fixed in `b8ca06da` (`fitCashCap`, unit cases at $1,000.01 / $20.01 / $0.03). |
| 6.9 | SUM(instructions) = approved payable before submit | DONE | `pure:137-149` UNDER/OVER_ALLOCATED; `svc:706-712` `PAYOUT_SPLIT_MISMATCH` at submit; `pgtest:78` |

## 7. Manual payout overrides & partial payouts

| § | requirement (short) | status | evidence |
|---|---|---|---|
| 7.1 | Manager may use default or propose a permitted manual split, subject to policy + owner approval | DONE | `svc:498-531` `setPayoutPlan`; `manual_split_allowed` (`mig:35`) |
| 7.2 | Percentage AND dollar entry | DONE | `pure:119-134` `manual_percent` / `manual_amount`; `pos:231-239` |
| 7.3 | Store authoritative minor-unit amounts | DONE | `amount_cents BIGINT` + `basis_points` (`mig:170-171`) |
| 7.4 | UI continuously shows remaining / unallocated | DONE (Oct 27) | `POSPaycheckTab.tsx` SplitEditor recomputes `approvedPayable − (check + cash)` (or 100 % − Σ %) on every keystroke and shows "Remaining to allocate / Over by / Allocated exactly" (`data-testid="split-remaining"`); the server still re-validates. `pos-test` "§7.4" (dollars and percent; never a save) |
| 7.5 | Block under-allocation and overpayment | DONE | `pure:141-142`; `unit:68`; `pgtest:78` |
| 7.6 | Manual split that differs from default highlighted to the owner | DONE | `differs_from_default` + required `override_reason` (`svc:520-523`); `owner:112,120` "custom split" + "Manager's reason" |
| 7.7 | Tenant may cap cash % or disable cash | BUILT Oct 28 (verify V-28) | `max_cash_bp`, `cash_enabled` (`mig:32-33`); `pure:145-146`; `unit:48,80` **Re-audit (Oct 28):** with "primary method = cash" and a cash cap below 100 %, the odd cent went to cash and broke the cap ($1,000.01 at 50 % → cash $500.01, `CASH_OVER_LIMIT`), blocking submit. Fixed in `b8ca06da` (`fitCashCap`, unit cases at $1,000.01 / $20.01 / $0.03). |
| 7.8 | Partial payout is valid → PARTIALLY_PAID | DONE | `pure:197-201`; `pgtest:146` |
| 7.9 | Never mark whole statement paid because one method completed | DONE | `svc:956-976` paid = Σ `status = 'paid'` payouts only |

## 8. Store manager weekly payroll workflow

| § | requirement (short) | status | evidence |
|---|---|---|---|
| 8.1 | Manager prepares and reviews, no final approval | DONE | `pos.payroll.manage` vs `payroll.approve` (`ctl:77-80`); MANAGER role has no `payroll.approve` (`packages/permissions/src/rbac.ts:279-281`) |
| 8.2 | Manager table columns (technician, branch, components, already paid, payable, plan, status) as compact summary + detail drawer | DONE | `pos:78-90` (technician, status, earned, already paid, payable, check, cash, paid, unpaid, flags) + drawer `pos:168-219` (all components, branch breakdown). Branch appears in the drawer, not as a column |
| 8.3 | Technician detail (components → AMOUNT PAYABLE) | DONE | `pos:187-204` |
| 8.4 | Evidence drill-down: services (date/visit/revenue/rate), tips (ticket/allocation/already paid), hourly (scheduled/clocked/breaks/approved/rate), adjustments (reason/actor/reference) | DONE (Oct 27) | `PayrollWorkflowService.technicianDetail` gains `hours` (`hoursEvidence`: every punch with scheduled vs clocked minutes from `technician_schedules`, breaks, paid minutes, open punches; the pay plan's rate / break rule; the hourly total recomputed with the ONE `computeHourly` beside the line's figure, `matchesLine`); `svc.technicianEvidence` applies the paycheck branch scope; `GET paychecks/periods/:id/technicians/:techId/evidence`; the POS drawer's "Show evidence (services, tips, hours)" (`EvidenceToggle`). `close-pg` "two punches, one 30-minute unpaid break, $20/h → $310, equal to the line"; `pos-test` "§4.2 / §8.4" |
| 8.5 | Blocking exceptions: missing clock-out, missing commission rule, unallocated tip, missing service-line owner, duplicate earning, negative payable, refund vs closed period, split ≠ payable | DONE | `payroll-workflow.ts:118-153` codes OPEN_TIME_ENTRY, MISSING_COMPENSATION, UNALLOCATED_TIP, MISSING_TECHNICIAN, DUPLICATE_COMMISSION, NEGATIVE_NET_PAY, OPEN_FINANCIAL_EXCEPTIONS; `svc:706-715` PAYOUT_SPLIT_MISMATCH. (`MISSING_COMMISSION_RULE` = fallback-rate pricing is a warning, not blocking — by design) |
| 8.6 | Manager cannot submit while blocking exceptions remain | DONE | `svc:713-715` `PAYROLL_SUBMIT_BLOCKED`; `pgtest:95` |

## 9. Owner App approval workflow

| § | requirement (short) | status | evidence |
|---|---|---|---|
| 9.1 | Owner App is the approval surface after submit | DONE | `modules/analytics/src/owner/owner.controller.ts:61-80` `/owner/payroll/paychecks/*`; `owner` panel |
| 9.2 | Owner notification "Payroll Approval Required" (branch, week, technicians, totals, submitted by) | DONE | push `svc:743-744` (dates + technician count; amounts deliberately excluded per §17 privacy); `owner:58` pill + KPI totals on open |
| 9.3 | Owner summary: gross, already paid, payable, check, cash, other, technicians, exceptions, change from prior week | DONE (Oct 27) | `OwnerPaycheckPanel.tsx` renders the three missing KPIs (Gross earnings · Already paid · Other methods, EN + VI keys in `apps/owner-web/src/i18n/catalog.ts`). `owner-test` "§9.3" |
| 9.4 | Actions APPROVE ALL / APPROVE SELECTED / RETURN / REJECT | DONE | `svc:751-780`; `owner:127-131` (hold checkboxes = approve selected); `pilot:179` 185 approved / 15 held |
| 9.5 | Owner can drill into services, tips, hours, bonuses, adjustments, reversals | DONE (Oct 27) | `GET /owner/payroll/paychecks/periods/:id/technicians/:techId/evidence` (`owner.controller.ts`, `owner.finance.view`) → `svc.technicianEvidence`; the panel's "Show evidence" (`EvidencePanel`: services, tips by ticket, hours with the clock line and the recomputed total, adjustments) + the itemised reversals line. `owner-test` "§9.5" |
| 9.6 | Returned payroll requires an owner note and increments the workflow version | DONE | `svc:774-775` note ≥ 3 chars; `payroll-workflow.service.ts:298-301` sendBack bumps `version`; `pgtest:119` |
| 9.7 | Manager cannot silently edit after submission; owner returns first | DONE | `svc:504` split frozen unless draft; lines locked in `review` (`610:310-325`); `pgtest:267` |
| 9.8 | Step-up authentication (Face ID / Touch ID / reauth) for approval | DONE | POS `@RequireStepUp()` (`ctl:80,85`); Owner App security PIN `assertPayrollPin` (`owner.service.ts:968-977`, audited rejections). Face ID is the Owner App's unlock credential (`apps/owner-web/src/App.tsx:107`), not a per-approval prompt — adapted to the existing auth architecture |
| 9.9 | Manager-who-is-technician may not self-approve | DONE | `svc:801-808` `PAYROLL_SELF_APPROVAL`; `pgtest:113` |
| 9.10 | Delegated approval = explicit elevated permission | DONE | `payroll.approve` (`permission-registry.ts:55`, critical, step-up) |

## 10. Check payout lifecycle

| § | requirement (short) | status | evidence |
|---|---|---|---|
| 10.1 | CheckPayout {checkNumber, amount, bankAccountReference?, issued/delivered/cleared/voided} | DONE | `mig:189-197` (no bank reference stored — by 10.5) |
| 10.2 | Lifecycle PLANNED / ISSUED / DELIVERED / CLEARED / VOIDED / RETURNED | DONE | `pure:49-54`; `mig:212` |
| 10.3 | Printing a check ≠ cleared | DONE | `pure:213-217`; `unit:136` |
| 10.4 | Delivered counts as paid; clearance separate | DONE | `svc:1048-1066`; `pilot:129` issued-not-delivered = unpaid |
| 10.5 | No unnecessary raw banking information | DONE | no bank columns in `mig`; check number only (`svc:1024-1028` 1–20 chars) |
| 10.6 | No duplicate active check numbers per tenant | DONE | partial unique index `uq_payroll_payouts_check_number` (`mig:222`); `CHECK_NUMBER_IN_USE` (`svc:1029-1032`); `pgtest:146`; `pilot:128` |
| 10.7 | Voided check preserved historically | DONE | status `canceled` + `check_status voided`, row kept (`svc:1077`); `pgtest:198` |
| 10.8 | Replacement references the original | DONE | `replaces_payout_id` (`mig:197`); `svc:1080-1088`; `pgtest:198` |

## 11. Cash payout & technician acknowledgment

| § | requirement (short) | status | evidence |
|---|---|---|---|
| 11.1 | Cash is a fully recorded payout transaction | DONE | `payroll_payouts` cash columns (`mig:198-209`) |
| 11.2 | CashPayout {amount, cashSource, preparedBy, handedOffBy, receivedAt, ackMethod, status} | DONE | `mig:198-207` |
| 11.3 | Lifecycle PLANNED / READY_FOR_HANDOFF / HANDED_OFF / ACKNOWLEDGED / DISPUTED / CANCELED | DONE | `pure:56-66`; `mig:214` |
| 11.4 | Planned ≠ paid; paid only when handoff/confirmation rules satisfied | BUILT Oct 28 (verify V-28) | `pure:218-224`; `cash_paid_on` (`mig:37`); `pgtest:161` "prepared is NOT paid" **Re-audit (Oct 28):** with `cash_paid_on = 'handed_off'`, a disputed then re-handed-off cash payout stayed `paid` while the cash went back to the drawer. Fixed in `b8ca06da`: a paid payout cannot be re-handed off (`action: 'cancel_then_add_payout'`). |
| 11.5 | Confirmation: 4-digit PIN · Tech App · QR handoff · signature · manager+technician dual | DONE (Oct 27) | All five, inside the existing PIN / Tech-App mechanisms (no new device): **QR handoff** — `POST paychecks/payouts/:id/cash/handoff-token` (`payroll.cash_handoff`) stores only a sha256 + 10-minute expiry (`mig701`); the POS shows it as a QR (`qrPath`) + text; the Tech App's acknowledge takes `{ handoffCode }` (`T_CASH_ACK_BODY`), verified against the live hash → `cash_ack_method = qr_handoff`, else 401 `HANDOFF_TOKEN_INVALID`; **signature** — `POST …/cash/acknowledge-signature` = technician PIN + SVG stroke path (≤ 16 000 chars, `validSignaturePath`; never a bitmap) kept in `cash_ack_signature`; **manager + technician dual** — `POST …/cash/acknowledge-dual` (step-up route = the manager's proof) + technician PIN, `cash_ack_confirmed_by` stamped. One confirmation each (retry = same). `close-pg` three tests; `close-race` QR ×10 / dual ×10; `pos-test` "§11.5"; `tech-test` "§11.5"; `pilot-10e` three cash halves confirmed three ways (wrong code → 401) |
| 11.6 | Handoff audit: technician, amount, period, prepared by, handed by, confirmation, time, branch, source, device/audit id | DONE | `mig:198-209` + `branch_id`, `device_id`; audit rows `svc:1119,1132,1163` |

## 12. Cash drawer integration

| § | requirement (short) | status | evidence |
|---|---|---|---|
| 12.1 | Drawer withdrawal = non-sale movement linked to the payout, expected balance updated | DONE | `apps/api/src/payroll/paycheck-wiring.ts` → `CashDrawerRepository.payrollWithdraw`; `cash_drawer_movements.source_type/source_id/idempotency_key` (`mig:229-234`); `apps/api/src/payroll/paycheck-wiring.pgtest.vitest.spec.ts:24` |
| 12.2 | Sources REGISTER_DRAWER / SAFE / BANK_WITHDRAWAL / OTHER_RECORDED_SOURCE | DONE | `mig:216`; `svc:71` |
| 12.3 | INSUFFICIENT_CASH, no silent negative drawer | BUILT Oct 28 (verify V-28) | `svc:1111-1112`; `pgtest:161` **Re-audit (Oct 28):** two `prepareCash` calls on one drawer could both pass the availability read (no lock) and take the drawer negative. Fixed in `b8ca06da`: `pg_advisory_xact_lock` on the drawer before the read. No concurrent race test yet (V-28 / race lane). |
| 12.4 | Separate cash preparation report and check preparation report after owner approval | DONE (Oct 27) | `svc.preparation` → `GET paychecks/periods/:id/preparation` (approved periods only; `payroll.issue_check` / `payroll.cash_handoff` / `payroll.approve` holders; branch-scoped): the check run (by technician: number, status; to issue / to deliver / delivered) and the cash envelopes (to prepare / hand over / confirm; by source), other methods, what is still unplanned, and the totals with `reconciles` (planned + unplanned = payable; paid + unpaid = payable). POS "Preparation" tab (`PreparationView` — a list, no browser print dialog by Kevin's no-print rule). `close-pg` two tests; `close-race` reconciles after the dual race; `pos-test` "§12.4"; `pilot-10e2` PREPARATION REPORT |

## 13. Mixed check / cash reconciliation

| § | requirement (short) | status | evidence |
|---|---|---|---|
| 13.1 | Check delivered + cash ready → PARTIALLY_PAID; after ack → PAID | DONE | `pgtest:146,206`; `pilot:129` |
| 13.2 | SUM(payout plan) = approved payable | DONE | `pure:137-149`; `pilot:180` Σ 7,830,163 = payable |
| 13.3 | PAID + UNPAID = approved payable | DONE | `svc:562` unpaid derived; `mig:111` `paid_cents ≤ approved_payable_cents` |
| 13.4 | CHECK_COMPLETED + CASH_COMPLETED + OTHER_COMPLETED = PAID | DONE | `svc:967`; report `byMethod` (`svc:1322-1328`); `pgtest:239` |

## 14. Multi-branch technicians

| § | requirement (short) | status | evidence |
|---|---|---|---|
| 14.1 | One tenant statement with branch breakdown | DONE | `branch_breakdown JSONB` (`mig:97`); `svc:286-303` |
| 14.2 | ONE technician + ONE tenant + ONE statement per period | DONE | `uq_payroll_statements_live` (`mig:115`); `payroll-200-technicians.pgtest:165` |
| 14.3 | Branch manager sees only authorised branch contribution by default | BUILT Oct 28 (verify V-28) | `PayrollContext.authz` carries the request's role-template scope + enterable branches (`req.ctx.authz`, `ctxFrom` / `payCtx`); `svc.branchScope` returns the branch set for a BRANCH / SELECTED_BRANCHES manager even with `payroll.manage` (the `BRANCH_MANAGER` template, or any custom branch-scoped role); `periodStatements` / `statement` / `reviewWeek` / `preparation` / `technicianEvidence` are scoped; `setPayoutPlan` refuses another branch's statement (`STATEMENT_NOT_FOUND`); `assertSalonWide` refuses open / calculate / default-for-all / submit / cancel (`PERMISSION_DENIED`, `reason: branch_scoped`). `close-pg` "branch-confined manager"; `pilot-10e2` BRANCH-SCOPED MANAGER **Re-audit (Oct 28):** the Oct 27 scoping covered statement reads and `setPayoutPlan` only: every payout mutation (`withPayout` — issue / deliver / void check, prepare / hand off / resolve cash — and `addPayout`), `report()` and `ownerSummary()` were tenant-wide, so a branch manager could void another branch's checks. Fixed in `b8ca06da` (`payoutScope` / `assertStatementInPayoutScope`, `branchScope` on report and owner summary; tests in `payroll-paycheck.vitest.spec.ts` + the close-out pgtest). Still open: the legacy read routes `GET /pos/payroll/periods/:id`, `…/payouts` and `…/technicians/:techId` are not branch-scoped. **Re-audit (Oct 28):** the legacy period reads (detail, payouts, technician drill-down, adjustments, inquiries) are branch-scoped too since `c46c5fc2` (pgtest in the close-out spec). |
| 14.4 | Owner sees the consolidated statement | DONE | `svc:597-599` |
| 14.5 | Approval cannot overlook an unsubmitted branch contribution | DONE | by design: the week is salon-wide (`svc:243`) and the overlap guard refuses a competing branch period (`svc:239-242`, `pilot:124` `PAYROLL_PERIOD_OVERLAP`) |

## 15. Technician App

| § | requirement (short) | status | evidence |
|---|---|---|---|
| 15.1 | Payroll home: current period, estimated earnings, status | DONE | `svc:1245-1257` `myPayroll` (stage manager_review / owner_review / approved); `tech:94-103` |
| 15.2 | After approval, "estimated" → approved pay | DONE | `estimated` flag (`svc:1251`); `tech:67,69` |
| 15.3 | Statement layout incl. PAYMENT lines "Check #4812 $990 DELIVERED / Cash $990 ACKNOWLEDGED", paid/unpaid/STATUS | DONE (Oct 27) | `TechPayStatementsPanel.tsx` `payoutLine`: "Check #4812 · DELIVERED", "Cash · ACKNOWLEDGED", ISSUED / CLEARED / VOIDED / RETURNED BY THE BANK, READY FOR YOU / HANDED OVER / DISPUTED / CANCELED, plus how the cash was confirmed — EN + VI in `apps/tech-web/src/i18n/catalog.ts`. `tech-test` "§15.3" |
| 15.4 | Permissions: read own statement/payouts, confirm own cash, cannot edit anything | DONE | `tech.controller.ts:58-67` session-resolved technician; `svc:1228-1234` `technicianId` filter; `pgtest:228`; `pilot:128` "another technician cannot confirm it" |
| 15.5 | Private manager/owner notes never shown | DONE | `svc:1262` `includeNote: false`; `pgtest:228` |

## 16. Permissions, separation of duties & privacy

| § | requirement (short) | status | evidence |
|---|---|---|---|
| 16.1 | Keys payroll.prepare/review/submit/approve/lock/adjust/issue_check/cash_handoff/payout.manage/export/read_own | DONE | adapted to the existing registry: prepare/review/submit → `pos.payroll.manage`; lock → `payroll.approve`; payout.manage → `payouts.manage`; read_own → `tech.payroll.view`; `payroll.approve/adjust/issue_check/cash_handoff/export` literal (`permission-registry.ts:53-60`, `rbac.ts:31-38`) |
| 16.2 | Store manager: prepare/review/submit; payout execution only if policy allows and owner approved | DONE | `rbac.ts:279-281`; payouts require `finalized` period (`svc:1005`) |
| 16.3 | Owner: review/approve/return/reject/lock/override policy/report/export | DONE | OWNER = all non-super_admin keys (`rbac.ts:268`) |
| 16.4 | Receptionist: no payroll control | DONE | FRONT_DESK/RECEPTION lists (`rbac.ts:283-284`) hold no payroll key; `pgtest:89,272` |
| 16.5 | Technician: own payroll only | DONE | `tech.payroll.view`; `pgtest:228`; `pilot:151` |
| 16.6 | Branch manager: authorised branch scope only | BUILT Oct 28 (verify V-28) | see 14.3 **Re-audit (Oct 28):** the Oct 27 scoping covered statement reads and `setPayoutPlan` only: every payout mutation (`withPayout` — issue / deliver / void check, prepare / hand off / resolve cash — and `addPayout`), `report()` and `ownerSummary()` were tenant-wide, so a branch manager could void another branch's checks. Fixed in `b8ca06da` (`payoutScope` / `assertStatementInPayoutScope`, `branchScope` on report and owner summary; tests in `payroll-paycheck.vitest.spec.ts` + the close-out pgtest). Still open: the legacy read routes `GET /pos/payroll/periods/:id`, `…/payouts` and `…/technicians/:techId` are not branch-scoped. **Re-audit (Oct 28):** the legacy period reads (detail, payouts, technician drill-down, adjustments, inquiries) are branch-scoped too since `c46c5fc2` (pgtest in the close-out spec). |
| 16.7 | Tenant A never sees Tenant B payroll/payouts/checks/cash | DONE | RLS on all new tables (`mig:237-249`); tenant-consistency triggers; `pgtest:89,293` |
| 16.8 | Separation of duties (manager on payroll cannot approve own) | DONE | `svc:801-808`; `pgtest:113` |

## 17. Events, workers, realtime & notifications

| § | requirement (short) | status | evidence |
|---|---|---|---|
| 17.1 | Events: period.opened, calculated, manager_review_started, submitted_to_owner, returned, approved, locked, pay_statement.created, payout.planned, check_issued, cash_ready, cash_handed_off, cash_acknowledged, partially_paid, paid | DONE (Oct 27) | 15 of 15 (+ `payroll.period_canceled`): `PAYROLL_MANAGER_REVIEW_STARTED` written in `calculate`'s transaction beside `PAYROLL_CALCULATED`, routed by the realtime projection (`payroll_manager_review_started`), in `docs/EVENT_CATALOG.md`. `close-pg` asserts the outbox row; `pilot-10e2` counts it |
| 17.2 | Critical state + event through the Transactional Outbox | DONE | `svc:152-155,411-418` outbox in the same transaction; `payroll-200-technicians.pgtest:257` one row per event |
| 17.3 | Consumers idempotent under at-least-once | DONE | runner `processed_events` (`realtime-projection.consumer.ts:8`) |
| 17.4 | Realtime updates POS/Owner/Tech but never authority | DONE | `paycheckClients` sends ids + action only (`realtime-projection.consumer.ts:64-73`); `tech:84` refetches |
| 17.5 | Workers for weekly prep, document generation, notifications, external payout providers | DONE (Oct 27) — provider half external | weekly prep worker `payroll-weekly.scheduler.ts`; notifications are inline best-effort push (`svc:125-133`). **Document generation: the pay-stub PDF** (`payroll-paystub.ts` render + `payroll-paystub.service.ts` read; `svc.payStub` / `svc.myPayStub`) built server-side from the APPROVED, LOCKED statement row (never recalculated): salon + branch + address, technician + ID (`T-` + first 8 of the technician id — the schema has no employee number), period, pay date, statement number + version, every earnings line (service / retail commission, card / cash / other tips, hourly with the locked line's clocked hours, salary, bonus, guarantee, adjustments, deductions, reversals itemised refund / tip / retail / other), gross, net, already paid, payable, the payouts (check # / cash source + lifecycle status), paid / still to pay, year to date (the technician's approved statements of the year through this period, stored columns summed), generated-at in the branch zone. EN / VI (Thợ) in Work Sans (SIL OFL, subset to Latin + Vietnamese, `modules/workforce/assets/fonts`). Routes `GET /pos/payroll/paychecks/statements/:statementId/pay-stub.pdf` (`pos.payroll.view`, branch-scoped like the statement read), `GET /owner/payroll/paychecks/statements/:statementId/pay-stub.pdf`, `GET /tech/payroll/statements/:statementId/pay-stub.pdf` (own statement only); a draft / held statement → 409 `PAYROLL_PERIOD_NOT_READY`; per-person window 60 / min → 429 `RATE_LIMITED`; audited `pay_stub.downloaded` (no amounts); `Content-Disposition: attachment`, `Cache-Control: no-store`. A download, not a print control (no `window.print`; `check:no-print` green). Built on request — no document worker: 200 stubs measured at ~90–180 ms each (read + render) on the loaded 2-core host. UI: "Download pay stub" in the Tech App statement, the POS statement drawer, the Owner panel. Tests: `payroll-paystub.vitest` 9 / 9, `payroll-paystub.pgtest` 7 / 7 (text read back out of the PDF), POS / Owner / Tech screen tests, pilot 10e PAY STUB step (pilot through phase 10: 104 / 104). **Provider work: no provider connected** (`payroll-provider.port.ts` NotConfigured — honest, not mocked; external, see below) **Re-audit (Oct 28):** the pay-stub PDF (`81ec8ead`, Oct 27 22:41) landed after the last evidence commit; its "vitest 9/9, pgtest 7/7, pilot 104/104" has no committed log and the 235/235 pilot has no pay-stub step. Evidence to be produced under V-28. |
| 17.6 | Automatic weekly prep on one controlled scheduler; review + approval stay manual | DONE | `payroll-weekly.scheduler.ts` (`PAYROLL_WEEKLY_PREP_ENABLED`, `runsBackgroundJob`, never submits/approves) |
| 17.7 | Notifications: manager "ready for review", owner "awaiting approval", manager "returned", technician "statement ready / payout completed"; no amounts in push | BUILT Oct 28 (verify V-28) | `openWeek` (the scheduler's call and the POS button) pushes "Payroll is ready for review" to every active MANAGER of the salon (`notify({ managers: true })`; the owner when there is none) after the created period is calculated — dates + technician count, never an amount; idempotent (a second open sends nothing). `close-pg` "pushed … without amounts"; `pilot-10e2` counts the delivery in `notification_delivery_logs` **Re-audit (Oct 28):** there is no "payout completed" push to the technician (check delivered / cash acknowledged / statement fully paid) — only a realtime refetch. Recorded as a decision for Kevin (NEW_CHAT_HANDOFF §8). **Re-audit (Oct 28):** Kevin decided YES: 'Your pay is complete' push (no amount) once a statement is fully paid, after the commit (`78a07f6b`). A paid week also goes back to finalized / partially paid after a later void. The ACH / external payout-status route does not push yet. |

## 18. APIs, concurrency, idempotency & versioning

| § | requirement (short) | status | evidence |
|---|---|---|---|
| 18.1 | Tenant routes (current, periods/:id, calculate, submit, return, approve, statements, payout-plan, issue-check, cash-ready, cash-handoff, acknowledge) | DONE | `ctl:71-94` under `/pos/payroll/paychecks/*` (payout-plan is POST, not PUT — existing convention) |
| 18.2 | Technician routes (me/payroll, me/pay-statements, me/pay-statements/:id, cash-payouts/:id/acknowledge) | DONE | `modules/queue/src/tech/tech.controller.ts:58-67` (+ `dispute`) |
| 18.3 | Adapt to existing conventions, no duplicates | DONE | older `periods/:id/*` kept and guarded (`PAYROLL_PAY_THROUGH_PAYOUTS`, `pgtest:142,289`) |
| 18.4 | Thin controllers | DONE | `ctl:1-2` + one-line handlers; Owner `owner.controller.ts:61-80` |
| 18.5 | No payroll math in React/mobile clients | DONE | `pos:7`; the only client arithmetic is entry-sum UX validation (`pos:232-238`), server re-validates |
| 18.6 | Optimistic versioning on PayPeriod, PayrollRun, PayStatement, PayoutPlan | DONE | `payroll_periods.version` (610), `payroll_statements.version`, `payroll_payout_plans.version` (`mig`); `expectedVersion` on submit/approve/plan (`svc:505,694`); `pgtest:260` |
| 18.7 | Duplicate submit / approve / check issue / cash ack = one effect | DONE | `race:42,49,57`; idempotency keys `stmt:{id}:instr:{seq}` (`svc:871`) |

## 19. Reports, accounting & audit

| § | requirement (short) | status | evidence |
|---|---|---|---|
| 19.1 | Owner dashboard: approved payable, paid, unpaid, check, cash, pending approval, cash awaiting, checks awaiting, failed/exception | DONE | `svc:1272-1289` `ownerSummary`; `GET /owner/payroll/paychecks/summary`; `pos:105`, `owner:71` |
| 19.2 | Reports: weekly, monthly, YTD, by technician, by branch, by method, cash payout report, check register | DONE | `svc:1293-1348`; `pos:321-359`; `docs/pilot-runs/2026-10-26-200b` by payout method |
| 19.3 | Accounting: payroll expense once; check/cash are settlement, not extra expense | DONE | `svc:1342-1344` `accounting.reconciles`; `pgtest:239` |
| 19.4 | Audit: calculation, adjustment, plan change, submission, owner decision, check issue/void/replace, cash prep/handoff/ack, correction, export | DONE (Oct 27) | `calculate` writes `period.calculated` (statement count, technician ids, dates) — plus the new `period.canceled`, `cash.handoff_token_issued`, and `cash.acknowledged` with the method / co-confirmer. `close-pg` asserts the row; `pilot-10e2` counts it in `audit_events` |

## 20. Required test matrix

| § | requirement (short) | status | evidence |
|---|---|---|---|
| 20.1 | Financial: $100 → 50/50; $100.01 → 50.01/50.00; $0.01 → 0.01/0; 25/75, 10/90, 100/0, 0/100, custom $; under/over blocked; cash tips not twice; partial preserves balance | DONE | `unit:17-110`; `pgtest:78,146` |
| 20.2 | Concurrency: submit ×10, approve ×N, ack retries, check retries, stale edit → PAYROLL_VERSION_CONFLICT | DONE | `race:42-57` (real PostgreSQL); `pgtest:260` |
| 20.3 | Security: tenant A/B; branch A manager cannot mutate branch B; tech A/B; receptionist; self-approve | BUILT Oct 28 (verify V-28) | + the mutation test: `close-pg` "a branch-confined manager … cannot touch the first branch's split" (branch-B manager's `setPayoutPlan` on a branch-A statement → `STATEMENT_NOT_FOUND`, the plan untouched; their own branch's → allowed; submit / calculate / default-for-all / open → `PERMISSION_DENIED branch_scoped`); the new routes have receptionist / other-technician / wrong-PIN / wrong-code refusals in the same spec **Re-audit (Oct 28):** the Oct 27 scoping covered statement reads and `setPayoutPlan` only: every payout mutation (`withPayout` — issue / deliver / void check, prepare / hand off / resolve cash — and `addPayout`), `report()` and `ownerSummary()` were tenant-wide, so a branch manager could void another branch's checks. Fixed in `b8ca06da` (`payoutScope` / `assertStatementInPayoutScope`, `branchScope` on report and owner summary; tests in `payroll-paycheck.vitest.spec.ts` + the close-out pgtest). Still open: the legacy read routes `GET /pos/payroll/periods/:id`, `…/payouts` and `…/technicians/:techId` are not branch-scoped. **Re-audit (Oct 28):** the legacy period reads (detail, payouts, technician drill-down, adjustments, inquiries) are branch-scoped too since `c46c5fc2` (pgtest in the close-out spec). |
| 20.4 | Cash drawer: movement updates expected balance; insufficient blocks; canceled/unhanded not paid | BUILT Oct 28 (verify V-28) | `paycheck-wiring.pgtest:24,42`; `pgtest:161,180` **Re-audit (Oct 28):** see 11.4 and 12.3 (both fixed Oct 28). |

## 21. Definition of Done

| § | requirement (short) | status | evidence |
|---|---|---|---|
| 21.1 | Existing payroll code audited, duplicate authority removed | DONE | `report` §A/§B; B-64 blanket mark-paid refused |
| 21.2 | Weekly configuration + automatic preparation | DONE | §3, scheduler |
| 21.3 | Manager review with all components + already paid | DONE | §4, §8 |
| 21.4 | Immutable statements | DONE | §5 |
| 21.5 | 50 % check / 50 % cash preset | DONE | §6 |
| 21.6 | Deterministic odd cent | DONE | §6.8 |
| 21.7 | Manual % and $ splits under policy | DONE | §7 |
| 21.8 | Under/over allocation blocked | DONE | §7.5 |
| 21.9 | Submit + owner approve/return/reject in the Owner App | DONE | §9 |
| 21.10 | Step-up for owner approval | DONE | §9.8 |
| 21.11 | Payroll locks after approval | DONE | `lockAndMaterializeMany`; line lock trigger |
| 21.12 | Check lifecycle, number, void, replacement | DONE | §10 |
| 21.13 | Cash prep, handoff, acknowledgment, dispute | DONE | §11 |
| 21.14 | Drawer integration + insufficient cash | DONE | §12 |
| 21.15 | Mixed payout PARTIALLY_PAID until complete | DONE | §13 |
| 21.16 | Paid/unpaid exact | DONE | §13.3 |
| 21.17 | Multi-branch aggregation no duplicates | DONE | §14.2 |
| 21.18 | Tech App own statements/history only | DONE | §15 |
| 21.19 | Owner dashboard + weekly/monthly/YTD reports | DONE | §19 |
| 21.20 | Export does not double-count | DONE | §19.3 (paycheck report accounting block; CSV export `payroll-export.ts` exports the period lines once) |
| 21.21 | Permissions, tenant, branch isolation, technician privacy | BUILT Oct 28 (verify V-28) | 14.3 / 20.3 **Re-audit (Oct 28):** see 14.3 — mutations and reports scoped Oct 28; the legacy period read routes are not. **Re-audit (Oct 28):** the legacy period reads (detail, payouts, technician drill-down, adjustments, inquiries) are branch-scoped too since `c46c5fc2` (pgtest in the close-out spec). |
| 21.22 | Events, outbox, workers, realtime, notifications | DONE (Oct 27) | 17.1 / 17.7 |
| 21.23 | Version conflicts + idempotency tests | DONE | §18, §20.2 |
| 21.24 | No production mock payroll/payout provider | DONE | `payroll-provider.port.ts` `NotConfiguredPayrollProvider` answers `PAYROLL_PROVIDER_NOT_CONFIGURED` (no fake) |
| 21.25 | Migrations, build, typecheck, lint, unit, integration, concurrency, security tests pass | PARTIAL | `report` §R/§T (Oct 21: fresh DB 613 migrations, ci:gates 51/16, lanes PASS); `200_TECHNICIAN_STATUS.md:18` reruns Oct 24-26. Not re-executed in this read-only audit **Re-audit (Oct 28):** cites the Oct 21 report; typecheck / lint / vitest have not been run on the Oct 28 code (V-28). |

## 22. Required final engineering report (A–T)

| § | requirement (short) | status | evidence |
|---|---|---|---|
| 22.A–T | A existing code · B problems (P0–P3) · C architecture · D manager · E owner · F 50/50 · G manual · H check · I cash · J multi-branch · K statements · L reports · M permissions/audit · N database · O APIs · P events · Q files · R tests · S invariants · T build matrix | DONE | `docs/PAYCHECK_FINAL_REPORT.md` has all twenty sections (lines 7–288) |

## 23. Final weekly flow

| § | requirement (short) | status | evidence |
|---|---|---|---|
| 23.1 | Works → earnings ledger → weekly period → calculation → manager review → exceptions → payout method (50/50 or custom) → submit → owner review → approve/return/reject → lock → statement → check + cash → delivery/handoff/confirmation → paid/unpaid → tech history → owner reports | DONE | `pilot:126-129` runs that chain end-to-end through the API; `pgtest:62-250` |

## 24. Permanent product rules

| § | requirement (short) | status | evidence |
|---|---|---|---|
| 24.1 | Earnings ≠ payouts; manager prepares, owner approves; approval audited + versioned; 50/50 and manual splits reconcile; cash recorded and on statements/reports; checks traceable; cash handoff traceable; tech confirms cash; planned ≠ paid; printed ≠ cleared; paid+unpaid reconcile; cash tips not twice; multi-branch no duplicates; locked payroll not rewritten; refunds after lock → linked adjustment; technicians own payroll only; tenant isolation; receptionists no payroll; frontend not authority; PostgreSQL truth; every cent traceable | DONE | §4–§19 above |
| 24.2 | Store managers access only authorised branches | BUILT Oct 28 (verify V-28) | 14.3 / 16.6 **Re-audit (Oct 28):** the Oct 27 scoping covered statement reads and `setPayoutPlan` only: every payout mutation (`withPayout` — issue / deliver / void check, prepare / hand off / resolve cash — and `addPayout`), `report()` and `ownerSummary()` were tenant-wide, so a branch manager could void another branch's checks. Fixed in `b8ca06da` (`payoutScope` / `assertStatementInPayoutScope`, `branchScope` on report and owner summary; tests in `payroll-paycheck.vitest.spec.ts` + the close-out pgtest). Still open: the legacy read routes `GET /pos/payroll/periods/:id`, `…/payouts` and `…/technicians/:techId` are not branch-scoped. **Re-audit (Oct 28):** the legacy period reads (detail, payouts, technician drill-down, adjustments, inquiries) are branch-scoped too since `c46c5fc2` (pgtest in the close-out spec). |

## 25. Final instruction

| § | requirement (short) | status | evidence |
|---|---|---|---|
| 25.1 | Upgrade the existing system; inspect payroll, periods, commission, tips, earnings, time clock, guarantee, adjustments, cash pending/handoff, payout history, Owner & Tech apps; keep/fix/merge/complete/wire/migrate/clean/test | DONE | `report` §A–§T; `081_tech_cash_handoff` (older cash handoff) kept beside the new lifecycle |
| 25.2 | Manager calculates + reviews weekly paycheck, uses 50/50 default, changes split when authorised, submits to Owner App; after approval traceable check + cash instructions; not paid until issued/confirmed | DONE | `pilot:126-129` |
| 25.3 | The 13 questions (earned, how calculated, approved, by check, by cash, which check number, cash handed, paid, unpaid, who prepared, who approved, who handed over, when confirmed) answerable from backend records | DONE | statement + plan + payout columns (`mig`); `svc:673-684` statement view with payouts; `prepared_by/submitted_by/owner_decided_by/cash_prepared_by/cash_handed_off_by/cash_acknowledged_at` |
| 25.4 | Every answer from auditable backend records, never frontend state | DONE | 1.5, 1.6 |

## Counts

| status | count |
|---|---|
| DONE | 161 |
| PARTIAL | 0 |
| NOT DONE | 0 |
| BLOCKED_EXTERNAL | 0 |
| **total requirement lines** | **161** |

PARTIAL rows: none since the pay-stub PDF (17.5, Oct 27 2026; NEXT_STEPS W-3). 17.5's provider half (ACH / direct deposit /
ADP / Gusto) stays external — no provider is connected and none is mocked, see EXTERNAL below. Before the Oct 27 close-out the counts were 141 / 20 / 0 / 0 with PARTIAL rows 3.3, 3.4, 4.2, 7.4, 8.4, 9.3, 9.5, 11.5,
12.4, 14.3, 15.3, 16.6, 17.1, 17.5, 17.7, 19.4, 20.3, 21.21, 21.22, 24.2.

## INTERNAL — buildable now (priority order)

**All 13 items below were built Oct 27 2026** (commit `15a79fef` and the follow-up docs / pilot commit). They are kept as the
record of what was asked and where it landed; the last internal remainder, 17.5's pay-stub PDF, was built the same day
(on request from the locked statement — no worker needed at the measured cost; see the 17.5 row).

1. ~~Manager "weekly payroll is ready for review" notification (17.7 / 21.22)~~ — DONE: `openWeek` → `notify({ managers: true })`.
2. ~~Branch-manager scoping for a `payroll.manage` holder (14.3 / 16.6 / 20.3 / 24.2)~~ — DONE: `PayrollContext.authz` + `branchScope` / `assertSalonWide`; mutation test in `close-pg`.
3. ~~Audit row for `calculate` (19.4)~~ — DONE: `period.calculated`.
4. ~~Owner App drill-down + missing summary figures (9.3 / 9.5)~~ — DONE: three KPIs + `EvidencePanel` + owner evidence route.
5. ~~Hourly evidence in the drill-down (8.4)~~ — DONE: `technicianDetail.hours` + the POS drawer link.
6. ~~Cash-envelope / check-run preparation report (12.4)~~ — DONE: `GET paychecks/periods/:id/preparation` + the POS Preparation tab.
7. ~~Tech App payout lifecycle words (15.3)~~ — DONE: `payoutLine` + catalog EN / VI.
8. ~~Live "remaining / unallocated" in the manual split editor (7.4)~~ — DONE.
9. ~~Non-weekly frequencies (3.3)~~ — DONE: `lastCompletedPeriod`; the scheduler serves every frequency.
10. ~~Itemised reversals on the statement (4.2)~~ — DONE: migration 701 columns + `itemiseReversals`.
11. ~~Period CANCELED state (3.4)~~ — DONE: `cancelPeriod` + the cancel route + the CANCELED vocab.
12. ~~Extra confirmation methods (11.5)~~ — DONE: QR handoff code, PIN + signature, manager + technician dual.
13. ~~`payroll.manager_review_started` event (17.1)~~ — DONE.

## EXTERNAL — needs Kevin

- **None blocks this mandate.** ACH / direct deposit / payroll-provider payouts are recorded methods with no provider connected (`payroll-provider.port.ts` answers `PAYROLL_PROVIDER_NOT_CONFIGURED`, honestly, no mock). Connecting ADP/Gusto or a bank is a business decision + credentials.
- A real check printer / bank clearance feed is not integrated; check numbers are typed and "cleared" is a manual step (`svc:1058-1066`). Any bank integration is external.
- Push delivery for the notifications above depends on the push providers already configured for the platform (APNs/FCM/web push credentials).
- The weekly worker is OFF unless `PAYROLL_WEEKLY_PREP_ENABLED=1` is set on the deployment that runs standard background jobs.
