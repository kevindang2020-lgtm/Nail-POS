# owner-web hardening — Cash Drawer + Daily Cash (both verified clean, sign convention locked)

Continued the owner-web money-screen sweep with the two cash-oversight screens. Both are **read-only** salon-wide reviews
(the front desk does the actual reconciling in the POS), both were untested, and both are correctly built — the valuable
outcome here is regression-locking the **cash variance sign convention**, which is exactly the kind of thing a refactor
could silently invert and quietly mislead an owner about whether a drawer is over or short.

## Sign convention (verified at the source, now locked by tests)
`apps/api/src/cash-drawer/cash-drawer.repository.ts` computes `varianceCents = countedCents − expectedCashCents` (lines 54
and 83), and the backend's own discrepancy alert phrases it as `varianceCents > 0 ? 'over' : 'short'`. The cash-summary
roll-up sums those (`register.varianceCents + techCash.varianceCents`). So across the system: **positive = over, negative =
short.** Both screens label exactly that way.

## OwnerCashDrawerScreen — verified clean
Per-branch register drawers for a date: `float + sales − refunds (+ in − out) = expected`, vs counted, with over/short.
Wiring: `ownerCashDrawerApi.state(date)` ↔ `GET /owner/cash-drawer`; every field the screen reads is present on the typed
`OwnerDrawerRow`. The KPI roll-ups (`totalExpected`, `totalCounted`, `netVariance`, reconciled/discrepancy/awaiting counts)
are correct reduces/filters, null-safe for uncounted branches; `money()` and the status map both defend against null/unknown.
No bug. **5 tests** added: roll-ups; per-branch over/short/balanced labels (sign lock); the "Not counted yet" state; the
empty state; a friendly 403.

## OwnerCashSummaryScreen — verified clean
End-of-day total cash position = register-drawer pool + technician-cash pool, with a balanced/over/short headline and a
CSV close-out export. Wiring: `ownerCashSummaryApi.state(date)` ↔ `GET /owner/cash-summary` (typed `DailyCashSummary` /
`CashPoolSummary`). The total label and each pool's `+`/`−` variance follow the same counted−expected convention. The CSV
button is correctly disabled until data loads and pulls the drawer + handoff detail to build the report client-side. No bug.
**6 tests** added: total position + balanced label; both pool variance signs; per-pool reconciled/discrepancy/awaiting
counts; total Over/Short when the day doesn't balance; the CSV-export wiring; a friendly 403.

## Verification
owner-web `tsc` clean, **40 tests pass** (10 files), `vite build` clean. (admin-web 151 / clean and backend 603 / PASS are
unchanged — read-only screens, no code changed beyond the new tests.)

## Remaining in owner-web (untested)
Money screens left: **FinanceReportsScreen, HardwarePaymentScreen**. Plus OwnerHomeScreen, BookingOverviewScreen,
StaffPerformanceScreen, BranchPerformanceScreen, AlertsScreen, AuditScreen, TechnicianDetailScreen, MoreScreen, LoginScreen,
and the static Privacy/Terms/Delete-account screens.
