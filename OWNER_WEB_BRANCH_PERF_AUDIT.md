# owner-web hardening — BranchPerformanceScreen (verified clean)

Audited Module 2: Overview (3 KPIs + ranked Revenue-by-Branch) and Comparison (quick-comparison cards + the same ranked list),
with period chips that refetch. Read-only, fully typed; it checks out. This completes the owner-web performance trio
(Staff → Technician detail → Branch).

## Verified clean
- **Both endpoints feed one typed shape, and the DTO mirrors every read.** `performance(period)` ↔ `/owner/branches/performance`
  and `comparison(period)` ↔ `/owner/branches/comparison` both return `OwnerBranchPerformanceState`. The DTO carries everything
  the screen reads: `totalRevenueCents`/`totalRevenueTrendPercent`, `topBranch{branchName,trendPercent}`, `activeBranches`,
  `branches[]{rank,branchId,branchName,revenueCents,trendPercent}`, and the `quickComparison` sub-objects
  (`bestGrowth{branchName,valuePercent}`, `highestAverageTicket{branchName,valueCents}`, `topBookings{branchName,value}`).
- **Null- and divide-safe.** `money()`/`money2()`/`trend()` floor at 0/handle null; the revenue bar clamps with
  `Math.max(1, …revenueCents)` and a 4% floor; `topBranch` and every `quickComparison` field is read through `?.` with `—`/`0`
  fallbacks (so the comparison-only and overview-only fields degrade cleanly when the other endpoint omits them). Empty branch
  list → honest empty state; 403 → friendly message + Retry.

No bug. **5 tests** added: the overview KPIs + ranked branch list; the period-chip refetch; the Comparison tab hitting the
comparison endpoint and rendering its cards (Best Growth / Highest ATV / Top Bookings); the empty state; and a friendly 403.

## Verification
owner-web `tsc` clean, **85 tests pass** (18 files), `vite build` clean. (admin-web 151, pos-web 75, tech-web 74,
customer-web 124, backend 603 / PASS — all unchanged; read-only screen, only new tests added.)

## Sweep status
**10 fixes** to date (admin-web 6, owner-web 3, pos-web 1, tech-web 1). owner-web now covers the money screens, home, booking,
alerts, and the full performance trio. Remaining owner-web: Audit, More, Login, and the static legal/delete screens.
