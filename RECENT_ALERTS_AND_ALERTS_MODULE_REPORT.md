# Recent Alerts card + full Alerts module — Build/Fix Report

Audit-first. The Recent Alerts **card** already existed on the Overview (sourced from the Overview's real derived
signals), but there was **no Alerts module, table, route, or sidebar item** — "View All" dead-ended at `/audit-logs`.
This pass enhanced the card and built a real, persisted Alerts module. Alerts are **materialized from real platform
signals** (payments, applications, hardware, gateway errors, support) — never fabricated — and are kept distinct from
`audit_logs` (immutable history) as actionable items (read / resolve / dismiss).

## 1. Files changed / added
**Backend — new module `apps/api/src/super-admin-alerts/`**
- `alerts-core.ts` — types (AlertType / AlertSeverity / AlertStatus), `applyFilters`, `paginate`, `summarize`,
  `canSetStatus`, severity/status badge maps (pure, tested).
- `alerts.repository.ts` — `AlertsRepo` port + `InMemoryAlertsRepo` (seedable; idempotent `syncFromSignals` by dedupeKey).
- `alerts.kysely.repository.ts` — Postgres adapter; `syncFromSignals` collects the real signals and upserts by `dedupe_key`.
- `alerts.service.ts` — status-transition validation + audit events (`alert_marked_read/unread`, `alert_resolved`,
  `alert_dismissed`, `alert_note_added`, `alerts_marked_all_read`, `alerts_synced`).
- `alerts.controller.ts` — SUPER_ADMIN-guarded routes (static routes declared before `:id`).
- `alerts.module.ts` — factory (Kysely when a DB handle exists, else in-memory); registered in `app.module.ts`.
- `alerts-service.spec.ts` — harness (core + service): summary, filter, sync idempotency, status, notes, mark-all-read.
- `db/migrations/088_alerts.sql` — new `alerts` + `alert_notes` tables.

**Frontend (`apps/admin-web/src/`)**
- `screens/AlertsScreen.tsx` — **new** full Alerts page: 8 summary KPIs, search + severity/type/status filters, alert
  list with severity + status badges, detail panel (Mark Read/Unread, Resolve/Dismiss with confirmation, Add Note,
  Open Related / Open Tenant), **Mark All Read**, and **Sync** (materialize from signals). Loading/empty/error+retry states.
- `api/superAdminApi.ts` — alerts clients (recent / list / summary / unread-count / detail / status / notes / mark-all-read / sync).
- `App.tsx` — route `path="alerts"`. `shell/AdminLayout.tsx` — sidebar item **Alerts** (active highlight on `/alerts`).
- `screens/DashboardScreen.tsx` — Recent Alerts card now shows a **severity badge** (High/Medium/Low) and **View All →
  `/alerts?source=overview-recent-alerts`** (was `/audit-logs`).
- `screens/AlertsScreen.test.tsx` — **new** (4 tests).

## 2. Frontend route
- **Added** `/alerts` inside the Super-Admin shell (sidebar "Alerts" highlights). No `*-new`/duplicate routes.

## 3. Frontend components
- **New**: `AlertsScreen` (page + summary cards + filters + list + detail panel + confirm modal). Reused the shared
  `.panel`/`.list`/`.badge`/`.modal` styles and `superAdminApi`. Recent Alerts card reused + enhanced (not duplicated).

## 4. Backend APIs (all under `@Controller('super-admin/alerts')`, SUPER_ADMIN guard)
`GET /recent`, `GET /summary`, `GET /unread-count`, `GET /` (search/severity/type/status/tenantId/sort/page/limit),
`GET /:id`, `PATCH /:id/status`, `POST /:id/notes`, `POST /mark-all-read`, `POST /sync`.

## 5. Backend services/calculations
- `SuperAdminAlertsService` over `alerts-core` (filter/summary/transition validation). `syncFromSignals` reuses the same
  real queries the Overview uses (payment-setup gaps, pending applications, hardware pending, 24h gateway errors).

## 6. Database
- **Added** `alerts` + `alert_notes` (088). No duplicate of `audit_logs` (history vs. actionable items). Reused
  `tenants`, `tenant_applications`, `hardware_packages`, `tenant_payment_config`, `payment_gateway_events`, `audit_logs`.

## 7. Existing modules reused / duplicate avoided
Recent Alerts card, the Overview signal queries, `audit_logs`, the shared admin styles + http client, and the SUPER_ADMIN
guard. No second alerts page, route, table, or service.

## 8. How to test Recent Alerts
- `cd apps/admin-web && npx vitest run src/screens/DashboardScreen.test.tsx`; open Overview → the card shows the newest
  alerts with severity badges + time; View All routes to `/alerts`.

## 9. How to test View All / the full Alerts page
- Backend: `cd apps/api && npx esbuild src/super-admin-alerts/alerts-service.spec.ts --bundle --platform=node | node` (25/25), or `bash scripts/run-core-specs.sh` (22 harness suites, 462 tests, RESULT: PASS).
- Frontend: `cd apps/admin-web && npx vitest run src/screens/AlertsScreen.test.tsx` (4/4); `npx tsc --noEmit`; `npx vite build`.
- Manual: Overview → Recent Alerts → **View All** → `/alerts?source=overview-recent-alerts` (sidebar "Alerts" active).
  Click **Sync** to materialize alerts from current signals → summary KPIs + list populate; search + severity/type/status
  filters re-query; click a row → detail panel → Mark Read/Unread, Resolve/Dismiss (confirmation), Add Note, Open Related.

## 10. Remaining setup
- Run migration `088_alerts.sql`.
- Schedule `POST /super-admin/alerts/sync` (cron/worker) so alerts stay materialized from live signals; until then the
  page shows an empty state with a one-click **Sync**. The Recent Alerts card on Overview already shows live derived
  alerts even before the first sync.
- Not built this pass (honest, deferred): assign-to-user, manual alert creation, and auto-generation hooks wired into all
  15 source events (the sync materializer covers payments / applications / hardware / gateway today). The table + status
  pipeline are in place to add these incrementally. Permissions are enforced at SUPER_ADMIN granularity via the guard.

## Verification
backend: `tsc` clean; **462 tests pass** + **22 harness suites** (alerts 25/25); `RESULT: PASS`.
admin-web: `tsc` clean; **79 tests pass** (incl. 4 Alerts); `vite build` clean.
