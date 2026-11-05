# Tenant Dashboard — Module Map

Canonical, single implementation (no DashboardV2/Final). The existing `/pos/dashboard` backend and
`POSDashboardScreen.tsx` were ENHANCED, not duplicated.

## Frontend (apps/pos-web/src)
- `screens/POSDashboardScreen.tsx` — rebuilt to the reference design: 8 KPI cards + 10 modules + Quick Actions.
- `api/posDashboardApi.ts` — `getState()` (canonical aggregate). Inventory Alerts reuse `inventoryApi.alerts()`.
- Routes: `/dashboard` (canonical, sidebar-linked) + `/tenant/dashboard` (additive alias per spec §17).

## Modules (image parity)
KPIs: Today's Revenue · Appointments Today · Walk-Ins · Active Services · Avg Ticket · Customers Served ·
Tips Today · Staff on Duty. Modules: Revenue & Sales Trend (area chart) · Today's Salon Snapshot ·
Live Service Floor · Today's Schedule · Customer Activity (Reminders/Messages/Missed Calls tabs) ·
Top Technicians · Inventory Alerts (canonical inventory module) · AI Insights (package-gated) ·
Payment Snapshot (donut) · Quick Actions (8).

## Backend (apps/api/src/dashboard) — reused
- `dashboard.controller.ts` `/pos/dashboard/state` (+ slice endpoints), permission `pos.dashboard.view`.
- `dashboard.service.ts` / `dashboard.kysely.repository.ts` — tenant+branch scoped aggregate (unchanged SQL).
- `dashboard.dto.ts` — ADDED pure §20 metric helpers: averageTicketCents, rebookRatePercent,
  utilizationPercent, onDutyPercent (tested in `dashboard-metrics.spec.ts`, 12/12).

## Reuse, not duplication
- Revenue trend, top technicians, payment mix, KPIs, today's appointments, walk-in status → existing aggregate.
- Inventory Alerts → canonical `/tenant/inventory/alerts` (the inventory ledger), NOT a second counter.
- Live Service Floor / Today's Schedule → derived from the same `calendar` payload Serving/Booking use.

---
## Handoff status
- Frontend dashboard complete + validated (tsc 0, build OK, 84/84 tests).
- Backend reused; metric helpers added + tested (12/12); 623/623 backend tests green.
- Next-phase data sources (currently shown as "—" / empty, no fake data): Tips Today, Rebook Rate,
  Customer Activity (reminders/messages/missed calls), per-tech Tips/Utilization, Sales Goal, Total
  Transactions on the trend summary. Wire each to its canonical service when available.
