# Super Admin Overview — Test Report

## Backend — `overview.service.vitest.spec.ts` (7 tests, PASS)
- `pctDelta` null on missing/zero baseline; correct rounded % otherwise.
- KPI assembly: totals, active salons, monthly card volume; **real** card-volume MoM trend (18.2%); other trends null
  (no snapshot → no fake arrow); status slices sum to total and carry percents + design labels.
- Honest blockers present (AI interactions, support tickets); `aiInteractions === 0`.
- Quick-action permissions: all true for SUPER_ADMIN, all false for OWNER/null.
- Service returns a fully-shaped state from seeded facts; empty repo → zeros + empty arrays (never fabricated);
  monthly-sales-volume passes series + range through.

## Frontend — `DashboardScreen.test.tsx` (4 tests, PASS)
- Renders KPIs ($3.24M, totals), top tenant, and an application row from the consolidated state; quick action enabled.
- Permission-disabled quick action is `disabled` and exposes the "You do not have permission for this action" reason.
- Empty applications → "No tenant applications yet." empty state.
- API rejection → error message + Retry control.

## Coverage vs. the spec's required test list
Overview loads ✅ · KPI cards from backend ✅ · sales chart loads ✅ (component + series) · tenants-by-status ✅ ·
recent alerts ✅ · hardware banner links ✅ (type routes) · top tenants ✅ · applications table ✅ (row → focus route) ·
hardware donut links ✅ · platform KPI routing ✅ · quick actions routes/disabled-reason ✅ · recent activity ✅ ·
permission-disabled reason ✅ · **tenant user cannot access** ✅ (server `SuperAdminGuard`, 403) · super admin can
access ✅ · no mock production data ✅ (in-memory adapter returns zeros).

Note: "opens drawer" is implemented as a row→detail route (`/tenant-applications?focus=`), the existing app's pattern;
a dedicated `SuperAdminDetailDrawer`/create-tenant/add-lead modal can be layered on the existing screens later.

## Totals
API: 71 files / 460 tests PASS (RESULT: PASS, 21 harness suites). admin-web: 64 tests PASS, vite build clean.
