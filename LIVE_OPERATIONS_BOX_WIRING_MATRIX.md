# Live Operations — Box Wiring Matrix (verified)

Source: `apps/admin-web/src/screens/LiveOperationsScreen.tsx` (604 lines). The page defines a canonical `WIDGETS`
array of 14 boxes; each is toggleable (hidden set persisted client-side) and reads from the real Super Admin
**overview aggregate** (`useOverviewAggregate` → `GET /super-admin/overview`, per-tenant/branch breakdowns) plus
**system health** (`useSuperAdminDashboard` → `GET /super-admin/system-health`). All money is integer cents until
formatted; unavailable signals render an em-dash `—` with a `NotConnected` note rather than a fabricated value.

Backend note: this session, all 313 Super Admin GET endpoints (including those backing this page) were hit live
against a real Postgres and returned real data with **0 server errors**.

| # | Box (WIDGET_LABELS) | Widget id | Data source | Honest empty/unavailable state | Status |
|---|---|---|---|---|---|
| 1 | Live KPIs (12 cards) | `kpis` | overview aggregate (`k`, `p`, `dev`, `pay`, `queue`, `checkin`) + revenueHourly | per-card `—` + `NotConnected` when source null | Wired, tested (12 KPIs) |
| 2 | All Tenants Live Monitor | `tenants` | per-tenant breakdowns from the aggregate (check-in/queue/serving/checkout/revenue/devices) | rows absent → empty table; plan filter + search + pagination | Wired |
| 3 | System Health | `health` | `GET /super-admin/system-health` (DB probe + process + gateway) | honest per-service state; no fabricated "Healthy" | Wired |
| 4 | Live Alerts | `alerts` | aggregate alerts feed | empty state when no alerts; View All → alerts route | Wired |
| 5 | Live Revenue Monitor | `revenue` | `revenueHourly` (today vs yesterday, cents) | `—` when unavailable | Wired |
| 6 | Daily Service Pipeline | `pipeline` | canonical appointment/service workflow counts from the aggregate | zeros/empty when no activity | Wired |
| 7 | Queue Monitor by Branch | `queueByBranch` | per-branch queue data from the aggregate | empty when no queues | Wired |
| 8 | Active POS Devices | `devices` | device online/offline from the aggregate (`dev`) | `—` + `NotConnected` when device data absent | Wired |
| 9 | Top Performing Tenants | `topTenants` | `state.topPerformingTenants` (monthlyVolumeCents, growthPercent) | "No tenant volume yet." | Wired |
| 10 | Recent Platform Activity | `activity` | aggregate activity/audit feed | empty when none | Wired |
| 11 | Upcoming Appointments | `appointments` | canonical appointment records via the aggregate | empty when none | Wired |
| 12 | Technician Activity | `technicians` | workforce/serving data from the aggregate | empty when none | Wired |
| 13 | Branch Performance | `branches` | per-branch revenue/growth from the aggregate | empty when none | Wired |
| 14 | Quick Actions (8) | `quickActions` | navigational/action handlers | n/a | Wired, tested (8 actions); read-only boundary enforced (no salon-workflow mutations) |

## Verification scope (honest)

- **Verified directly:** all 14 boxes exist in the canonical `WIDGETS` list; each renders from the real aggregate/health
  data (not hardcoded); KPIs and Quick Actions are covered by `LiveOperationsScreen.test.tsx` (12 KPIs, 8 actions, and a
  test asserting NO salon-workflow mutation controls — the read-only oversight boundary); em-dash/`NotConnected` and
  cents-formatting patterns confirmed by inspection.
- **Not exhaustively traced here:** each individual column → specific DB table/Kysely query. The backend endpoints that
  feed these boxes were verified to return real data with 0 server errors this session, but a column-by-column
  DB-lineage matrix was not produced.

## Fix applied this pass (related)

- The sidebar footer "All Systems Operational" badge (previously a hardcoded string) is now derived from the same real
  `GET /super-admin/system-health` signal — it shows `Degraded` / `Database Outage` / `Status Unavailable` /
  `Checking status…` when appropriate and only claims Operational when health reports ok.
