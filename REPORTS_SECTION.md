# Sidebar wiring — Reports section (2026-07-06)

Wired to the existing `reports` backend module (GET /pos/reports/*), no backend changes.

## Done — 7 of 13 report screens (real, data-driven, tested)
| Route | Screen | Endpoint | Gate |
|---|---|---|---|
| /tenant/reports/sales | Sales | /pos/reports/state | financial |
| /tenant/reports/services | Services | /pos/reports/services | reports.view |
| /tenant/reports/technicians | Technicians | /pos/reports/technicians | financial / technician_view |
| /tenant/reports/payments | Payments | /pos/reports/payments | financial |
| /tenant/reports/customers | Customers | /pos/reports/customers | financial / customer_view |
| /tenant/reports/appointments | Appointments | /pos/reports/booking | reports.view |
| /tenant/reports/tax | Tax | /pos/reports/tax | financial |

Each: period control (today/week/month/year) that refetches, KPI cards, chart/table, and
loading / 403 / error / empty states. Shared helpers in `screens/reportsCommon.tsx`.

## Verification
- tsc 0 · build clean · lint clean.
- 14 new report screen tests total. Full pos-web **343/343** (incl. tenant-nav wiring invariant).
- Live E2E through real guards: all 7 endpoints anon **401** / authed **200**, each returning the
  exact shape its screen renders (e.g. tax → {taxableSalesCents, taxCollectedCents, byCategory, …}).

## Remaining 6 report items — need OTHER backend modules (not the reports module)
- commission, payroll → compensation module
- inventory → inventory reports (inventory.reports.view)
- marketing → marketing module
- ai → AI reports
- multi-location → owner multi-location aggregation
These are larger than the reports-module quick-wins; each is a proper feature slice.

## Sidebar tally
55 → **62** items on real screens.
