# Sidebar wiring — Reports → Sales (built end-to-end, 2026-07-06)

Picked the highest-value placeholder and wired it for real. `/tenant/reports/sales` now renders a
dedicated Sales Report screen instead of the FeaturePage placeholder.

## What was already there (reused, not rebuilt)
- Backend: full `reports` module — `GET /pos/reports/state|sales|services|...`, permission-gated
  `pos.reports.view` (+ `pos.reports.export`). No backend changes needed.
- Frontend API client existed (`posReportsApi.ts`) but only had `exportReport`.

## What I built
- `apps/pos-web/src/api/posReportsApi.ts` — added `state()` and `sales()` methods.
- `apps/pos-web/src/screens/POSSalesReportScreen.tsx` — new screen:
  - 9 KPI cards (gross/net/service/product sales, tips, tax, avg ticket, tickets, customers).
  - Revenue-trend bar chart from `salesTrend.points`.
  - Top-services table from `revenueByService`.
  - Period segmented control (today / week / month / year) that refetches.
  - CSV export via the existing export endpoint. Loading / 403 / error / empty states.
- `apps/pos-web/src/styles.css` — added `.seg`, `.tbl`, `.bars`, `.p-h` (Champagne-Gold tokens, Mac-fit).
- `apps/pos-web/src/App.tsx` — dedicated route `tenant/reports/sales` → the screen.
- `apps/pos-web/src/shell/tenant-nav.tsx` — registered the route in `EXISTING_ROUTES` so the
  FeaturePage fallback no longer also claims it (the wiring-invariant test enforces no double-registration).

## Verification
- tsc 0 · build clean · lint clean.
- Tests: 3 new screen tests (KPIs + trend + services render; period refetch; 403 message).
  Full pos-web suite **335/335** — including the `tenant-nav.wiring` invariant that caught (and now
  passes) the anti-double-registration check.
- Live E2E through the real guards: `GET /pos/reports/state` → anon **401**, authed tenant **200**
  with the `salesKpis` shape the screen renders.

## Sidebar tally
55 → **56** items now on real screens; 101 placeholders remain (roadmap in SIDEBAR_WIRING_STATUS.md).
The remaining Reports items (services, technicians, payments, …) are the natural next batch — same
backend module already provides their data.
