# Changelog — Tenant Dashboard
## Changed (no duplication)
- Rebuilt `POSDashboardScreen.tsx` to the reference design (8 KPIs + 10 modules + Quick Actions), card-level
  states, cream/gold tokens. Updated `POSDashboardScreen.test.tsx` to the new contract.
- Added §20 metric helpers to `dashboard.dto.ts` (+ `dashboard-metrics.spec.ts`, 12/12).
- Added `/tenant/dashboard` route alias (canonical `/dashboard` preserved).
## Reused
- Existing `/pos/dashboard/state` aggregate (SQL untouched → 623 backend tests still green).
- Canonical inventory alerts for the Inventory Alerts module.
