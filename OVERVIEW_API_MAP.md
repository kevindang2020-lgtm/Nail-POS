# OVERVIEW_API_MAP.md

## Reused (canonical — not duplicated)
- `GET /pos/overview/state` → rich `PosOverviewResponse` (kpis, schedulePreview, todayAppointments, walkInStatus,
  analytics.{revenueTrend, topServices, topTechnicians, paymentMix, quickInsights}). Owned by `OverviewService` →
  `OverviewRepo` (Kysely/in-memory). Guards: `TenantAuthGuard` + `RolePermissionGuard('pos.overview.view')`.
- Also available on the same controller: `/kpis`, `/today-summary`, `/revenue-trend`, `/top-services`,
  `/top-technicians`, `/payment-mix`, `/insights`, `/alerts`, and `?shape=summary` (flat projection).

## Added (supplement only — composition, not duplication)
- `GET /pos/overview/board` → `{ communications, customerRetention, inventoryAlerts, lastUpdatedAt }`.
  New `OverviewBoardController` + `OverviewBoardService` in the **same** `OverviewModule`. Same guards/permission.
  Tenant+branch scoped from the session; each block fail-soft to a safe empty shape (raw SQL, try/catch).

## Frontend client
- `apps/pos-web/src/api/posOverviewApi.ts` → `getOverview()` (rich state), `getBoard()` (supplement),
  `getState()` (legacy flat, kept for back-compat).

## Isolation & auth (every endpoint)
Session resolves tenantId/branchId/role/permissions; scope never trusted from the client; `pos.overview.view`
enforced server-side; Super Admin rejected by `TenantAuthGuard`.
