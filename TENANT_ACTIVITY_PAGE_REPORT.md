# Tenant Activity — dedicated faceted page (the "View All" target)

Built the dedicated, faceted **Tenant Activity** page you asked for and pointed both "Recent Tenant Activity" View All
buttons at it (Overview + Tenants / Salons). It's a presentation layer over the existing **`audit_logs`** table — **no new
table** — so it never double-writes events and the raw Audit Logs page still exists separately.

## What it is
A read-model that formats each `audit_logs` row into a dashboard-friendly activity item (category + icon + title +
severity + salon name), with server-side search, filters, summary, and pagination.

## Backend — new module `apps/api/src/super-admin-tenant-activity/` (no new table)
- `tenant-activity-core.ts` — pure + tested: `categoryFor` (tenant/payment/hardware/ai/application/support/other),
  `severityFor`, `toActivity(rawRow)` (reuses the overview `activityPresentation` for icon/title), `applyFilters`,
  `paginate`, `summarize`.
- `tenant-activity.repository.ts` — port + `InMemoryTenantActivityRepo` (empty feed, never fabricated).
- `tenant-activity.kysely.repository.ts` — reads `audit_logs` joined to `tenants` (salon name + code), guarded.
- `tenant-activity.service.ts` — validates/sanitizes query params; **summary reflects the active filters**.
- `tenant-activity.controller.ts` — `@UseGuards(SuperAdminGuard)`; `GET /super-admin/tenant-activity` (list) and
  `GET /super-admin/tenant-activity/summary`.
- `tenant-activity.module.ts` — DI factory (Kysely when a DB handle exists, else in-memory); registered in `app.module.ts`.
- `tenant-activity.service.vitest.spec.ts` — 10 tests (categorize, severity, format, filter, paginate, summarize, service
  + sanitization + empty feed).

## Bug fixed along the way
The Overview recent-activity query selected `audit_logs.action`, but the real column is **`action_type`**. Because the
query is `.catch`-guarded, the activity feed would have silently returned **empty in production**. Now `al.action_type as
action` — so the feed actually populates. (`apps/api/src/super-admin-overview/overview.kysely.repository.ts`)

## Frontend
- `apps/admin-web/src/screens/TenantActivityScreen.tsx` — summary KPIs (Total / Tenant / Payment / Hardware / AI /
  Warning·Error), search + event-type + category + severity + date-range filters (filters reset to page 1), paginated
  table (Event · Tenant/Salon · Description · Severity · Actor · Created), a detail panel on row click (with "View in
  Audit Logs" + "Open tenant"), page-size selector, prev/next, and loading / empty / error-with-retry states.
- `App.tsx` — new route `/tenant-activity`.
- `api/superAdminApi.ts` — `tenantActivity(q)` + `tenantActivitySummary(q)` clients.
- View All → `/tenant-activity` from both the **Overview** activity card (added a View All) and the **Tenants / Salons**
  card (was `/audit-logs?type=tenant_activity`).
- `screens/TenantActivityScreen.test.tsx` — 4 tests (KPIs + row, category filter pass-through, detail panel, empty state).

## No duplication
Reused `audit_logs` (single source) + the overview `activityPresentation` map. No new table, no second activity feed.
The Audit Logs page remains the raw, permanent trail; Tenant Activity is the faceted dashboard view over the same data.

## Permissions
Both endpoints are `SUPER_ADMIN`-guarded (backend is the source of truth).

## How to test
- Backend: `cd apps/api && npx vitest run src/super-admin-tenant-activity/tenant-activity.service.vitest.spec.ts` (10/10),
  or `bash scripts/run-core-specs.sh` (72 files / 473 tests, RESULT: PASS).
- Frontend: `cd apps/admin-web && npx vitest run src/screens/TenantActivityScreen.test.tsx` (4/4).
- Manual: Overview or Tenants / Salons → **Recent Tenant Activity → View All** opens `/tenant-activity`; try the search,
  category/severity/event-type/date filters, paging, and click a row for the detail panel.

## Honest scope notes
- **No separate `tenant_activity` table** — `audit_logs` is the single source (per the spec's guidance). Events are
  written by the modules that already audit; the feed reflects them automatically.
- Severity/category are **derived from the action name** (not stored columns), so the service loads the most-recent 2000
  audit rows and filters/paginates them in-core. For a tenant with more than 2000 recent events, older events fall
  outside the window — flagged, not faked. If you want unbounded history, the next step is to push the category/severity
  derivation into SQL `CASE` expressions so filtering/paging happen fully in Postgres.
- The detail panel uses the row already fetched (no separate `/:id` endpoint, which the spec listed as optional).

## Verification
backend: `tsc` clean; **473 tests pass** (72 files) + 22 harness suites; `RESULT: PASS`.
admin-web: `tsc` clean; **88 tests pass** (16 files); `vite build` clean.
