# Super Admin Overview command center — Build/Fix Report

Audit-first. The Overview command center already existed and was wired frontend → backend → database; this pass closed
the remaining gap (month-over-month trends) honestly. No duplicate page, route, KPI component, service, or table was created.

## What already existed (reused, not duplicated)
- **Page/route**: `DashboardScreen` is the Overview at **`/dashboard`** (sidebar "Overview" active there). Header already
  reads `Overview` + `Platform command center · {totalTenants} tenants · {name}` with **totalTenants from the backend**
  and the **name from the authenticated principal** (`/auth/me` via `AuthContext`).
- **7 KPI cards**, all wired to real backend fields with correct **trend-colour-by-meaning** (`invert` on Pending
  Applications / Payment Setup Needed / Open Support Tickets so "down = good" shows green) and **clickable navigation**
  (Total Tenants→/tenants, Active→/tenants?status=active, Pending→/tenant-applications, Payment Setup→/payment-gateways,
  Card Volume→/platform-reports, Support→/support-access, System Health→/system-health).
- **Backend**: `GET /super-admin/overview/state` (SUPER_ADMIN-guarded) computes every card from real tables — tenants
  (total + active by status), tenant_applications (pending), tenant_payment_config (payment-setup-needed),
  tenant_daily_sales_summary (current + prior month card volume), super_admin_support_sessions (open support, honestly
  mapped — there's no support-ticket table), and payment_gateway_events (system health from 24h errors).

## The gap this pass fixed: real month-over-month trends
Previously only **Monthly Card Volume** had a real trend; the other baselines were null (flat "vs last month"), because
state-based metrics can't be reconstructed from history. Fixed honestly:
- **Total Tenants** now has a real MoM trend — the prior-month baseline is computed exactly from `tenants.created_at`
  (tenants created before this month = the total as of last month).
- **Active Salons / Pending Applications / Payment Setup Needed / Open Support Tickets** now read their prior-month
  baseline from a new **`overview_monthly_snapshots`** table when a snapshot exists; until one does, they stay null
  (the UI shows no arrow rather than a fabricated one).
- **`POST /super-admin/overview/snapshot`** (guarded) captures the current month's KPIs (idempotent per month) so trends
  become accurate from next month onward.

## 1. Files changed
**Backend (`apps/api/src/super-admin-overview/`)**
- `overview.kysely.repository.ts` — real `totalTenantsPrior` from `created_at`; prior-month snapshot read for the
  state-based baselines (guarded → null when the table is empty/absent); new `captureMonthlySnapshot()`.
- `overview.repository.ts` — added optional `captureMonthlySnapshot()` to the data port.
- `overview.service.ts` — `captureSnapshot()` (no-op on the in-memory adapter).
- `overview.controller.ts` — `POST snapshot` route (SUPER_ADMIN guard).
- `overview.service.vitest.spec.ts` — +3 tests (real trends from baselines, null when no baseline, capture no-op).
- `db/migrations/087_overview_monthly_snapshots.sql` — new snapshots table.

**Frontend (`apps/admin-web/src/`)**
- `screens/DashboardScreen.tsx` — header always shows a Super-Admin name (`principal.fullName || 'Super Admin'`),
  never a hardcoded production value.

## 2. Frontend route
- **No new route.** Overview stays at `/dashboard` (sidebar "Overview"). The spec's `/super-admin/overview` maps to this.

## 3. Frontend components
- **No new components.** Reused `DashboardScreen` + its `KpiCard` / `Trend` (trend colour by metric meaning) and `Donut`.

## 4. Backend API
- **Reused** `GET /super-admin/overview/state` (the spec's `…/overview/summary` — single call returns all cards). **Added**
  `POST /super-admin/overview/snapshot` for monthly capture.

## 5. Backend services/calculations
- Reused `SuperAdminOverviewService` + the pure `buildOverview` core (`pctDelta`). Added the real Total-Tenants baseline,
  snapshot-backed baselines, and `captureSnapshot()`.

## 6. Database
- Reused tenants, tenant_applications, tenant_payment_config, tenant_daily_sales_summary, super_admin_support_sessions,
  payment_gateway_events. **Added** `overview_monthly_snapshots` (087) — the optional analytics table the spec describes.

## 7. Existing modules reused / duplicate avoided
Whole Overview page, the overview module, and the state endpoint were reused. No `*-new` route, no second summary
endpoint, no duplicate KPI components or tables.

## 8. How to test the Overview page
- Backend: `cd apps/api && npx esbuild src/super-admin-overview/overview.service.vitest.spec.ts --bundle --platform=node | node` (9/9), or `bash scripts/run-core-specs.sh` (71 files / 462 tests, RESULT: PASS).
- Frontend: `cd apps/admin-web && npx vitest run src/screens/DashboardScreen.test.tsx`; `npx tsc --noEmit`; `npx vite build`.
- Manual: open Overview → header shows real tenant count + your auth name; all 7 cards load from `/state`; arrows/colours
  follow metric meaning; cards navigate to the routes above; loading + error/retry states render.

## 9. Remaining setup
- Run migration `087_overview_monthly_snapshots.sql`.
- Schedule `POST /super-admin/overview/snapshot` monthly (cron/worker) — after the first month, Active Salons / Pending
  Applications / Payment Setup Needed / Open Support Tickets will show accurate MoM trends. Total Tenants and Monthly Card
  Volume trends are already real today. (Open Support Tickets remains mapped to active support sessions until a dedicated
  support-ticket system exists — flagged in the overview blockers, not silently faked.)

## Verification
backend: `tsc` clean; **462 tests pass** (71 files) + 21 harness suites; overview spec 9/9. admin-web: `tsc` clean;
**75 tests pass**; `vite build` clean.
