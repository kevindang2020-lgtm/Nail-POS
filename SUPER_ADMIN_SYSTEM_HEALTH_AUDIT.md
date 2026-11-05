# Super Admin → System Health — audit & coverage

Page: `apps/admin-web/src/screens/SystemHealthScreen.tsx` (route `/system-health`). Live process + DB metrics from
GET /super-admin/system-health. Previously had no test; now covered.

## Result: verified clean — no bug
- `systemHealth()` ↔ `@Get('system-health')` → `system-health.service.ts buildHealth()`, which **always** returns fully
  populated `process` (uptime/node/pid/RSS/heap/env) and `database` objects, so the screen's `h.process.*` / `h.database.*`
  access (guarded only by the top-level `!h` check) is safe in production.
- The screen already handles the optional DB fields defensively (`latencyMs != null`, `counts?.tenants ?? '—'`,
  `serverVersion || '—'`) and the **DB-down path** (`database.ok === false` → shows the error and hides the counts grid).
- `ok` reflects live database connectivity; values come from the running API process + a Postgres probe (no fabrication).

## Tests added (4, all pass)
`SystemHealthScreen.test.tsx`: Operational banner + process/DB metrics render; `fmtUptime(90061)` → "1d 1h 1m 1s"; DB counts
render when reachable; the **degraded** path shows the probe error and hides counts without crashing; a rejected fetch
surfaces the error instead of spinning.

## Verification
admin-web `tsc` clean, **138 tests pass** (27 files), `vite build` clean. No backend change; backend remains 603 / PASS.

## Series status — corrected
Screen-test coverage across `admin-web/src/screens` now stands as: every active Super Admin **dashboard** page is covered
**except** `AuditLogsScreen` (a real page — has pagination; good next target). `LoginScreen` (auth) and `ProjectStatusScreen`
(internal status) also lack dedicated tests. `LeadsScreen`/`HardwareScreen` are dead/unrouted legacy (replaced by
`WebsiteLeadsScreen`/`HardwarePackagesScreen`) and are exercised by existing legacy specs.

Bugs found & fixed across the audit series: Applications (pagination cap), Users & Roles (pagination cap + label),
Usage Limits (null→0 backend coercion), Billing (status dropdown mis-render), Payment Gateways (defensive null guard).
Hardware Payments, Hardware Payment Reports, and System Health verified clean and locked with tests.
