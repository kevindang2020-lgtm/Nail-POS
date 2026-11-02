# Deep verification — Super Admin Overview + Tenants/Salons (build, fixes, wiring, modules)

Full cross-check of both modules end-to-end: frontend → API client → controller → service → core → repository,
plus guards, module registration, route resolution, and a clean typecheck/test/build on both apps. **No defects found;
no code changes needed this pass.**

## Frontend → backend route contract (every call resolves to a real, guarded route)
Overview screen (`DashboardScreen`) calls only:
- `GET /super-admin/overview/state` ✓  → `super-admin-overview` controller (`@Get('state')`)
- `GET /super-admin/overview/monthly-sales-volume` ✓  → (`@Get('monthly-sales-volume')`)

Shared top bar (`AdminLayout`, on both screens):
- `GET /super-admin/alerts/unread-count` ✓  → `super-admin-alerts` (`@Get('unread-count')`)
- `GET /super-admin/platform/state` ✓  → `super-admin-platform` (`@Get('state')`)

Tenants screen (`TenantsScreen`) calls only:
- `GET /super-admin/tenants/state` ✓
- `POST /super-admin/tenants` (create) ✓
- `POST /super-admin/tenants/:id/support-access` ✓
- `PATCH /super-admin/tenants/:id/status` ✓
- `POST /super-admin/tenants/:id/warning` ✓
- `GET /super-admin/tenants/:id/payment-gateway` ✓
- `GET /super-admin/tenants/:id/audit` ✓
- `GET /super-admin/platform/top-performing-tenants` ✓
- `GET /super-admin/overview/state` (cross-cutting KPIs + bottom cards) ✓
Every method invoked by these two screens maps 1:1 to an existing backend route. No client calls a missing path.

## Guards (backend is the source of truth)
`@UseGuards(SuperAdminGuard)` confirmed on: `super-admin/overview`, `super-admin/alerts`, `super-admin/platform`,
`super-admin/tenant-activity`, and the `super-admin` (tenants) controller. All Overview/Tenants data + mutations are
SUPER_ADMIN-gated server-side.

## Module registration (app.module)
All eight registered: SuperAdminOverviewModule, SuperAdminTenantsModule, SuperAdminPlatformModule,
SuperAdminTenantActivityModule, SuperAdminAlertsModule, SuperAdminBillingModule, SuperAdminDashboardModule,
SuperAdminOwnersModule.

## Navigation targets (no dead links from either module)
`/dashboard` (index redirect), `/tenants`, `/tenant-applications`, `/platform-reports`, `/subscriptions` (with
`/billing`→`/subscriptions` redirect), `/payment-gateways`, `/hardware-packages`, `/tenant-activity` — all present in
`App.tsx` under the `AdminLayout` shell. KPI clicks, Quick Actions, View All, View Full Report, and the row action menu
all resolve to real routes.

## KPI trend wiring (Tenants/Salons)
Overview DTO `kpis.trends` exposes `{ totalTenants, activeSalons, pendingApplications, monthlyCardVolume }`
(all `number | null`), each populated by `pctDelta(current, priorBaseline)` in overview-core. The four Tenants KPI cards
read exactly these keys → real month-over-month deltas. `pausedTenants`/`trialTenants` are intentionally not in the
snapshot, so those two cards render "vs last month" (by design, never fabricated).

## Data integrity (no fabricated numbers)
Card volume / growth / top-performers come from approved `payments` aggregated by month; tenant counts/status from
`tenants` (+ `tenant_subscriptions`, `tenant_payment_config`); activity from `audit_logs` joined to `tenants`. InMemory
repos return zeros/empty (never seeded fakes); kysely queries are `.catch`-guarded so a query failure degrades to empty
rather than crashing the page. Real MoM trends are `null` until the overview snapshot job has run
(`POST /super-admin/overview/snapshot`), surfacing as "vs last month" — honest, not faked.

## Build / test status (fresh run)
- API: `tsc` clean; **479 tests** across 73 files; `RESULT: PASS`.
- admin-web: `tsc` clean; **93 tests** across 16 files; `vite build` clean.

## Known, intentional limitations (carried forward — not defects)
1. Real MoM trends need at least one overview snapshot; until then trends show "vs last month".
2. Paused/Trial KPI cards have no MoM baseline in the snapshot (show "vs last month").
3. Tenant Performance report search/sort/pagination run client-side over the backend's ranked top-100.
4. `tenant-activity/:activityId` detail resolves within the bounded recent audit window.
5. Warning email/SMS dispatches only if Postmark/Twilio are configured; otherwise saved as pending/skipped.
Each can be extended on request; none breaks current functionality.

## Verdict
Overview and Tenants/Salons are fully built, correctly wired frontend→backend→database, permission-enforced, and green
on typecheck/tests/build. No fixes required.
