# The money chain — Fair Turn → Service Done → Checkout → Payment → Earnings → Pay Period → Approval → Lock → Payout/Export → Refund/Reversal

Oct 13 2026 (FLOW, Kevin's mandate: "one explainable Fair Turn Engine … must not create another payroll system beside the
existing one … preserve working code, merge duplicates, repair partial wiring, migrate data safely, and finish the entire
flow"). This page is the map of the ONE chain, what was merged onto it, and how it is proved live.

## The one authority at every hop

| Hop | The one place | Reads it |
|---|---|---|
| Fair Turn assign | `modules/ai … fair-turn-engine.ts` (pure) over the turn queue `modules/workforce/src/turn-queue` (turn-core, append-only `technician_turn_events`) | AI queue assignment service (RECOMMEND_AND_CONFIRM / MANUAL / AUTOMATIC), POS Turn Queue + Turn History screens, Tech App rotation card |
| Service Done | `modules/queue/src/service-done` → TURN_CREDIT event + ticket `service_done` | Tech App, POS tech queue |
| Checkout + Payment | `modules/checkout` (tenders, idempotent card/cash, sandbox fake behind the gateway port — PAYI owns the real adapters) | POS Checkout |
| Commission + tip earnings | the immutable `ticket_compensation_snapshots` written at payment by `CompensationService.snapshotPaidTicket` (rule → service rate → tenant default, discount basis, tip allocation) + the `compensation_adjustments` ledger | **every** money read below |
| Pay period → prepare → approve → lock | `modules/workforce/src/payroll` (`payroll-workflow.service`: prepare = canonical lines from the snapshot in the salon zone; approve = step-up + hash; mark paid = DB lock trigger 610) | POS Payroll screen, Tech App payroll |
| Payout / export | `payroll_payouts`, `payroll_exports` (sha256 audited CSV) | POS Payroll |
| Refund / reversal | `CheckoutService.afterRefund → CompensationService.reverseForRefund` → ledger entry; a paid period routes it to the NEXT open period (pending, `original_period_id`), exception `refund_closed_period` | POS Payroll review tab, next PREPARE |

## Duplicates merged onto the authority (Oct 13 2026)

| # | What existed beside the authority | Merged how |
|---|---|---|
| D1 | Tech App dashboard + `/tech/earnings` computed "price × stamped rate" per line (UTC day, no discounts, rules or reversals) | `TechService.todayFromSnapshot`: both read `sumByTechnicianPeriod` over the salon-zone day; the line estimate only when no snapshot source is wired |
| D2 | dead `earningsLines` / `todayEarningsLines` readers (no callers) | removed |
| D3 | Live Technician Schedule detail re-priced lines with the technician's current rate, tips always 0 | `sumByTechnicianPeriod(…, branchId)` (new branch scope); tips now real |
| D4 | POS team list / productivity / trends / member detail = sales × current rate | `CompensationSnapshotRepository.commissionByTechnician` (snapshot + posted adjustments) |
| D5 | Owner analytics `staffSales` float re-pricing (`line_total × rate / 100.0`) | snapshot + adjustments SQL, branch-scoped |
| D6 | Checkout ticket detail resolved its own precedence (rules > stamp > current tech > service > 50 % guess, undiscounted) | `CompensationService.previewForTicket` (snapshot for a paid ticket, engine otherwise) → `commission.source` |
| D7 | hand-typed "manual payroll line" (POST/DELETE `periods/:id/lines`, gross × rate, keyed like the canonical line, silently replaced by PREPARE) | removed (route, service, schema, POS form); off-POS money is an Adjustment (reason, approval, rebuilt by PREPARE) |
| D8 | Commission Report ignored posted reversals and used UTC days | adjustments ride along per technician; window in the branch/tenant zone |
| T1 | five legacy scoring policies (hybrid, least_minutes, least_customers, first_available, fixed_order) = a second ranking authority | each one IS its fairness mode (`normalizeRotationPolicy`, stored and read); `fixed_order`'s list is honoured under `manual_order` (`applyConfiguredOrder`); the weighted path survives only when no turn-queue adapter is wired (no database) |

Also fixed by the proof: a pro-rata partial refund diluted the reversal by the ticket's tip and tax (a $45 refund of a
$45 service paid as $60.24 reversed $20.17) — the ledger now measures against the commissionable capture
(`RefundEvent.nonCommissionableCents` = captured − subtotal).

## One calculation (ONE-PAY, Oct 13 2026)

Kevin: "there is still only one payroll system … can you make into one only." There is exactly ONE place that calculates
commission, tip shares, technician earnings and payroll amounts. Everything else reads its results, asks its preview, or
says null + a note. No fallbacks, no estimates, no second formula.

**The authority (the only files allowed to do the arithmetic)**

| File | Owns |
|---|---|
| `modules/workforce/src/compensation/compensation-engine.ts` | `computeTicketCompensation` / `computeServiceLine` (the split), `allocateTips` (THE one tip allocation), retail commission, supply, guarantee |
| `modules/workforce/src/compensation/commission-basis.ts` | the basis (`commissionableBaseCents`) and THE per-line formula `lineCommissionCents` (the engine's split calls it) |
| `modules/workforce/src/compensation/compensation-rule-loader.ts` | THE rate precedence: authored rule → service rate → tenant default (`pickLineCommission`, `stampCommissionOnLine`) |
| `modules/workforce/src/compensation/compensation.service.ts` + `compensation-snapshot.repository.ts` + `compensation-adjustments*.ts` | the immutable snapshot at payment, the ledger, `previewForTicket` (unpaid work = the engine), the per-technician reads (`sumByTechnicianPeriod`, `commissionByTechnician` incl. tips) |
| `modules/workforce/src/payroll/*` | pay periods / lines built FROM the snapshot + ledger |
| `packages/money/src/index.ts` | the integer primitives only: `percentOfCents`, `splitByPercent` (the one percent split), `allocateByLargestRemainder` |

**Readers converted (file → what it reads now)**

| # | File | Computed on its own | Now |
|---|---|---|---|
| F1 | `modules/queue/src/tech/tech-dashboard.dto.ts`, `tech.service.ts`, `tech.kysely.repository.ts` | `commissionForLine` / `earningsSnapshot` line estimate (price × stamped rate) + UTC tips when the snapshot was not wired / failed | `todayFromSnapshot` only; otherwise sales from the lines, commission + tips **null + note** (`TechEarningsSnapshot` fields `number \| null`, tech-web shows "—") |
| F2 | `modules/workforce/src/technicians/technicians.kysely.repository.ts` | row / KPI `estimatedCommissionCents`, `payrollSnapshotCents`, payroll summary = today's sales × CURRENT rate; tips hard-coded 0 | `CompensationSnapshotRepository.commissionByTechnician` over the branch civil day (commission + tips + posted ledger) |
| F3 | `compensation-engine.ts` (inside the authority) | three percent formulas (tech split, tech-funded salon share, retail) + supply | one `lineCommissionCents` → `splitByPercent`; `percentOfCents` for the rest |
| F4 | `modules/workforce/src/commission-report/commission-report.dto.ts` | `commissionForLine` fallback for rate-only lines | the snapshot's `commissionCents` (required); absent ⇒ 0, never re-priced |
| F5 | `modules/workforce/src/technicians/technicians.dto.ts` | dead `commissionForLine` / `summarizeEarnings` wrappers | removed (`commissionForLine` removed from commission-basis too) |
| F6 | `modules/queue/src/service-done/*`, `modules/queue/src/serving/*` | hard-coded `COMMISSION_RATE = 15` estimate on every row / KPI / detail | `null` (unpaid work is priced by the engine preview on the checkout detail) |
| F7 | `modules/queue/src/live-technician-schedule/live-technician-schedule.repository.ts` (in-memory) | sales × stored percent | holds snapshot cents verbatim (`seedSnapshotDay`) |
| F8 | `modules/memberships/src/memberships-core.ts` | its own `round(elig × pct / 100)` split | `splitByPercent` (the engine's split primitive; workforce cannot be imported — cycle) |
| F9 | `apps/pos-web/src/screens/MembershipPlanBuilder.tsx` | frontend computed the technician share | shows the % and the eligible value; "calculated by payroll at each redemption" |
| F10 | `modules/queue/src/tech-queue/tech-queue.kysely.repository.ts` | tips today = `sum(tickets.tip_cents)` by PRIMARY technician | each technician's share from the snapshot (`commissionByTechnician.tipsCents`) |
| F11 | `modules/analytics/src/dashboard/dashboard.kysely.repository.ts` | top technicians tips = tickets.tip_cents by primary | snapshot share over the salon day |
| F12 | `apps/api/src/events/consumers/in-app-notification.consumer.ts` | no allocation yet ⇒ the whole tip to the primary technician | no fallback: a tipped ticket with technician lines and no allocation is retried (TRANSIENT `tip_allocation_pending`) |
| F13 | `modules/queue/src/queue/visit-ticket.ts` | its own rate precedence (rule → service row as-is → null; a 'none' service kept its stray value, later read as a %) | `pickLineCommission` + `defaultCommissionForTenant` (+ `policy_id` / `rule_source`) |
| F14 | `apps/api/scripts/{tech_earnings_check,commission_snapshot_check,verify-tech-earnings,verify-tech-tips}.ts` | local copies of the old line formula | removed (superseded by `live-money-chain.mjs`) |

Merged earlier (FLOW D1–D8, above) and still reading the authority: POS team, owner analytics staff sales, Live Schedule
(DB), checkout detail preview, Commission Report, Tech App canonical earnings.

**The gate** — `npm run check:one-payroll-calculation` (`apps/api/scripts/check-one-payroll-calculation.mjs`, in
`tooling/ci/run-gates.mjs`). Scans every non-test file of `modules/*/src`, `apps/*/src` (API + all frontends),
`packages/*/src`, `apps/api/scripts` outside the authority and FAILS on: R1 a percent applied on a payroll line, R2 a
payroll-named value from a multiplication, R3 a tip divided by a head count, R4 a retired formula by name, R5 an engine /
primitive call, R6 SQL arithmetic on a commission rate column, R7 a ticket's whole tip attributed to its primary
technician, R8 a line rate stamped outside `pickLineCommission`. Reviewed exceptions:
`apps/api/scripts/one-payroll-calculation.allowlist.json` — ONE entry (memberships-core R5, the shared split primitive,
dependency cycle); a stale entry fails. Proof: the HEAD-before tree reports 60 findings; 10 sabotage cases (one per rule
+ two frontends) fail and pass again on restore.

**Display-only (fine — they show server numbers)**: Tech App "% of sales" and earnings trend (ratios of server values),
Commission Report `effectiveRatePercent`, checkout commission row `percent` (share of the authority's preview), Live
Schedule (DB) sum of the snapshot's fields, owner payroll screens (payroll lines), tech self-service (snapshot), POS
"Tips (Est.)" on Service Done / Checkout (salon revenue, not a technician share), manager-pay `computeTipCents` and the
customer tip prompts (the guest's tip AMOUNT, not a split), super-admin revenue residuals (platform revenue, not payroll).

## Fair Turn §155–159

- §155 skills cache — DECIDED: none. The eligibility gate reads skills per request; a cache keyed by tenant/branch/technician/skillsVersion would add an invalidation path for no measured need.
- §156 appointment freshness — COMPLETE: the recommendation re-reads appointments; the assignment itself is validated transactionally (expected technician + queue version → 409).
- §157 preferred technician — COMPLETE: `walkInPolicy = PREFERRED_TECHNICIAN_FIRST` recommends the preferred/previous technician; `FAIR_TURN_ENGINE` (default) and "first available" go through the engine.
- §158 language — BUILT: `turnPolicy.languageMatch` OFF / SOFT (default) / HARD. The guest's `customers.preferred_language`; a technician's profile languages + app language (`languageCode` normalises names to codes). SOFT: the first speaker takes the guest, everyone passed keeps her place with `LANGUAGE_MATCH`; HARD: non-speakers are ineligible (`language_mismatch`); unknown is never "does not speak".
- §159 hard vs soft — COMPLETE: stage 1 hard eligibility, stage 4 soft preferences (requested → preferred → language), never mixed.

## The live proof

`apps/api/scripts/live-money-chain.mjs` boots ONE API against a real PostgreSQL (`DATABASE_URL`, sandbox card
processor) and drives: three clock-ins JOIN → RECOMMEND_AND_CONFIRM (why lines, confirm, replay) → MANUAL (no reason,
MANUAL_ASSIGN + SKIP recorded, position kept) → AUTOMATIC (auto-run, `auto_assigned` decision) → Service Done ×3
(TURN_CREDIT) → card + tip / cash / card (replay = same payment) → snapshot ($27.00 + $10.00 tip) → the Tech App,
checkout detail, Live Schedule, POS team and Commission Report all equal it → a second location (branch attribution) →
PREPARE (review, hash) → APPROVE (step-up, receptionist 403) → EXPORT (sha256) → PAYOUT + MARK PAID (Σ paid = payable;
the DB refuses an update) → the Tech App lists both periods only once approved → REFUND after the lock (−$27.00 pending
in the next period, linked to ticket and locked period; locked lines byte-for-byte unchanged; owner exception) →
approve → next PREPARE (payable floored at 0, review required) → location 2's half refund (−$15.00) stays at location 2
→ Turn History reads ASSIGN → START → COMPLETE → TURN_CREDIT → cleanup. 24/24 on Oct 13 2026; 25/25 with the ONE-PAY check
(POS Technicians row + POS Tech Queue tips = the snapshot).

Run: `DATABASE_URL=postgres://…/<scratch copy> node scripts/live-money-chain.mjs` from `apps/api` (built). Never
production — it creates and removes two proof branches.
