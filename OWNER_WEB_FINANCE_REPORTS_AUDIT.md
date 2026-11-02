# owner-web hardening — FinanceReportsScreen (verified clean) + money cluster complete

Closed out the owner-web money sweep with `FinanceReportsScreen` (Module 5): a Summary tab (revenue hero, net-profit EST,
expenses, avg ticket, transactions, tax, tips, payment-mix bars) and a Reports tab (catalog with real CSV export).

## Verified clean
- **Wiring is exact.** All four calls map to real routes (`/owner/finance/summary`, `/owner/finance/payment-mix`,
  `/owner/reports`, `/owner/reports/:id/export`), and the client types are a field-for-field mirror of the backend DTOs —
  `OwnerFinanceSummary` (totalRevenue, revenue/profit trend, expenses, commission, net profit, avg ticket, transactions,
  tax, tips, discounts), `OwnerPaymentMix`, `OwnerReportInfo`, `OwnerReportExport` all match. Unlike the hardware screen,
  these are properly typed (not `any`), so the compiler already guards the field reads.
- **`trend()` is crash-safe.** A zero/null/undefined/NaN percent falls through to the hardcoded flat branch and never calls
  `.toFixed`, so a missing trend value can't throw (the failure mode that bit the admin-web gateway screen).
- `money()`/`money2()` are null-safe; the whole-dollar hero vs cents-everywhere distinction is intentional; payment-mix
  bars clamp to a 2% minimum width so tiny slices stay visible; the CSV export is a standard client-side blob download
  with the period + selected branch passed through; 403s surface a friendly message.

No bug. **6 tests** added: KPI money formatting; up/down trend directions; payment-mix rows; the empty-mix state; report
CSV export wiring (period + branch); a friendly 403.

## owner-web money cluster — complete
| Screen | Result |
| --- | --- |
| ExpensesScreen | **bug fixed** — new expense now attaches to the viewed branch (was saving null-branch and vanishing) |
| OwnerCashDrawerScreen | clean — variance sign (counted−expected) locked |
| OwnerCashSummaryScreen | clean — pool + total variance signs locked |
| HardwarePaymentScreen | **2 bugs fixed** — broken invoice React keys; saved-card last4 never displayed |
| FinanceReportsScreen | clean |

Every money-handling owner screen now has tests, with 3 real bugs fixed across the cluster.

## Verification
owner-web `tsc` clean, **53 tests pass** (12 files), `vite build` clean. (admin-web 151 / clean and backend 603 / PASS
unchanged — read-only screen, no code changed beyond the new tests.)

## Remaining in owner-web (non-money)
OwnerHomeScreen, BookingOverviewScreen, StaffPerformanceScreen, BranchPerformanceScreen, TechnicianDetailScreen,
AlertsScreen, AuditScreen, MoreScreen, LoginScreen, and the static Privacy/Terms/Delete-account screens.
