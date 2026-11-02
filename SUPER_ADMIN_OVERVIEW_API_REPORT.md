# Super Admin Overview — API Report

## Endpoints (new module `super-admin-overview`, `@UseGuards(SuperAdminGuard)`)
- `GET /super-admin/overview/state?range=day|week|month|year` → the full consolidated `OverviewState`.
- `GET /super-admin/overview/monthly-sales-volume?range=…` → `{ range, series[] }` for the chart's range switch.

## `OverviewState` shape
`kpis` (+ `trends`), `monthlySalesVolume[]`, `tenantsByStatus[]`, `recentAlerts[]`, `hardwareSummary`,
`topPerformingTenants[]`, `recentTenantApplications[]`, `hardwarePackageStatus[]`, `platformKpis`,
`quickActionsPermissions`, `recentActivity[]`, `blockers[]`, `generatedAt`.

## Architecture (mirrors `super-admin-dashboard`)
`overview.dto.ts` (types) → `overview-core.ts` (pure assembly, unit-tested) → `overview.repository.ts`
(`OverviewDataPort` + `InMemoryOverviewRepository`, zeros/empty, never fabricated) → `overview.kysely.repository.ts`
(Postgres aggregations, each query independently `.catch`-guarded so a missing column degrades one metric to 0, never
crashes the page) → `overview.service.ts` → `overview.controller.ts` → `overview.module.ts` (binds Kysely when a DB
handle exists, else in-memory). Registered in `app.module.ts`.

## Frontend client
`admin-web/src/api/superAdminOverviewApi.ts`: `superAdminOverviewApi.state()/monthlySalesVolume()` + the
`useSuperAdminOverviewState(range)` hook (loading/error/range/reload). Uses the shared `api` fetch client
(`credentials: include`, `VITE_API_BASE`/`window.APS_API_BASE` aware).

## Security
SUPER_ADMIN role enforced server-side by `SuperAdminGuard` (403 for tenant users). `quickActionsPermissions` are
returned per-request; the UI disables actions (with a reason tooltip) the principal lacks.
