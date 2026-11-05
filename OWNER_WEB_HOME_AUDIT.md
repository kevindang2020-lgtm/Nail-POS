# owner-web hardening — OwnerHomeScreen (verified clean)

Audited owner-web's primary dashboard (Module 1) — the largest untested owner screen: a "Today's Revenue" hero + trend
sparkline, six KPI cards, a 7-day revenue chart, and a self-contained End-of-Day Cash card. Read-only; it checks out.

## Verified clean
- **Wiring is exact.** `ownerDashboardApi.state(branchId)` ↔ `GET /owner/dashboard/state`, and the typed
  `OwnerDashboardState` is a field-for-field mirror of the backend DTO — every revenue/trend/count field the hero and KPIs
  read (`todayRevenueTrendPercent`, `weeklyRevenueTrendPercent`, `totalBookingsTrendPercent`, `averageTicketTrendPercent`,
  `tipsTrendPercent`, `newClientsTrendPercent`, plus the cents) is present (owner.dto.ts lines 6–12).
- **No latent display crashes.** `trend()` falls through to a hard-coded flat branch for zero/null/NaN (no `.toFixed` on a
  missing value); `money()` is null-safe; the "On Duty" percentage guards division by zero (`scheduledTechnicians > 0`); and
  both the `Sparkline` and `RevenueChart` handle an empty series without producing NaN geometry.
- **The cash card can never block the dashboard.** It owns its fetch, swallows errors, and renders nothing when there's no
  cash activity (`technicianCount === 0`) — so a cash-handoff failure leaves the rest of the dashboard intact.
- 403s show an honest error with Retry + Sign out; realtime events refresh the dashboard; the per-salon overview cards only
  fetch in the combined multi-salon view.

No bug. **5 tests** added: hero revenue + up-trend + KPI cards (with money formatting and the on-duty ratio); navigation to
bookings from the Total Bookings KPI; a friendly 403 with a working Retry; the End-of-Day Cash card showing with activity and
tapping through; and the card hiding when no technician handled cash.

## Verification
owner-web `tsc` clean, **58 tests pass** (13 files), `vite build` clean. (admin-web 151 / clean, pos-web 75 / clean,
tech-web 58 / clean, customer-web 107 / clean, backend 603 / PASS — all unchanged; read-only screen, only new tests added.)

## Sweep status
9 real bugs fixed to date (admin-web 6, pos-web 1, owner-web 2, tech-web 1). owner-web now has every money screen plus the
home dashboard covered. Remaining untested owner-web screens are read-only/secondary: BookingOverviewScreen,
StaffPerformanceScreen, BranchPerformanceScreen, TechnicianDetailScreen, AlertsScreen, AuditScreen, MoreScreen, LoginScreen,
and the static Privacy/Terms/Delete-account screens.
