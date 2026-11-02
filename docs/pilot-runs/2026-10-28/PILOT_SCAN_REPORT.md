# PILOT_SCAN_REPORT.md — whole-repository pilot scan, Oct 28 2026

Requested by Kevin after the last mandate: "pilot, deeper scan for bugs, errors, open gaps, modules not wired, what is
still open — fix and finish it, then pack the code for the developer." Branch `merge-github-main`, scan started at
`45e59ed9`, fixes in `3c6880b2`, `bfe23c7a`, `cf603852`. **Nothing pushed** (K-12 first — `BUG_REGISTER.md`).

Environment: the offline container of the Oct 28 full-system test (`docs/full-system-test/2026-10-28/`) — PostgreSQL 16,
Node 22, esbuild, Chromium; **no npm registry**, so vitest / Nest / Vite are stand-ins (`tooling/full-system-test/`).
Every verdict below says what ran. Nothing below is marked PASS that did not run.

## 1. Wiring (modules, controllers, routes, clients, buttons)

| Check | How | Result |
|---|---|---|
| Every domain module is imported by the API | `modules/*` vs `@aipowersalon/<module>` imports under `apps/api/src` | **27 / 27 imported** |
| Every `@Controller` is registered in a Nest module | controller files vs `*.module.ts` imports (4 declare their module in the same file) | **all registered** |
| Frontend API calls reach a real route | `check:dead-client` / `check:crosswire` / `check:unreached` gates (OpenAPI manifest, 3,126 routes) | **PASS** (unchanged) |
| In-app navigation reaches a declared route | new `tooling/full-system-test/dead-routes.mjs` — every `navigate()` / `<Link to>` / `to:` / `href:` string vs each app's `<Route path=>` table (7 apps) | **12 dead targets found → fixed** (`3c6880b2`); 0 remain (pos-web `/forgot-password` is served outside the router — not dead) |
| No enabled button without a handler | new `dead-buttons.mjs` (brace-balanced JSX tag parse; `disabled` = intentional) | **0** |
| Every frontend compiles | new `bundle-all.mjs` — esbuild of each entry, third-party modules stubbed so only our resolve / syntax errors surface | **7 / 7 clean** (admin, customer-display, customer, manager-pay, owner, pos, tech); booking-public + kiosk are static HTML |
| Environment variables the code reads are documented | `process.env.X` in apps/api, modules, packages vs `ENV_INVENTORY.md`, `SECRETS_REQUIRED.md`, `EXTERNAL_SETUP_CHECKLIST.md`, `DEPLOYMENT.md`, `.env.example` | **170 read, all documented**; the only undocumented names are test-only (`LOAD_*`, `SCALE_TESTS`, `PG_RACE_URL`, `*_WRITE` baseline writers) |
| Migrations | 647 files, sequential; the one historical `017` / `017a` collision is handled in `migrate.mjs` | OK (all applied on PG 16 in the Oct 28 run) |
| "Coming soon" / stub surfaces | grep of TODO / FIXME / not implemented / coming soon in product code | **0 TODO/FIXME**; the only honest "not implemented" is Tap to Pay without CommerceHub credentials (501 by design, X-9); the customer Profile "coming soon" branch is unreachable (every row has a route); the admin "Coming soon" sidebar branch has no disabled item |

### The 12 dead navigation targets (all fixed)

| App | Was | Now |
|---|---|---|
| pos-web Booking | `/customer-queue` | `/queue` |
| pos-web AI Calendar | `/pos/booking` | `/booking` |
| pos-web Tech Queue (×2) + Check-In test fixture | `/tenant/communications` | `/messages` |
| pos-web AI Business Setup | `/tenant/settings/business-hours`, `/tenant/services`, `/tenant/technicians` | `/settings?section=auto-logout`, `/services`, `/technicians` |
| pos-web Service Add-Ons | `/tenant/services` | `/services` |
| pos-web AI Settings | `/tenant/settings/booking`, `/tenant/settings/notifications` | `/settings?section=booking-appointments`, `/settings?section=notifications` |
| admin-web Tenants directory | `/customer-data?…`, `alert:overdue_payments`, `support`, "View All Tickets" | `/customer-data-oversight?…`, `/subscriptions?filter=past_due`, `/alerts` (no support-center route exists — relabelled "View All Alerts") |
| customer-web Deal detail (guest) | `nav('/login')` (no such route) | `exitGuestMode()` — the guest exit every other screen uses |

## 2. Unit sweep of the specs the Oct 28 test did not reach

`docs/pilot-runs/2026-10-28/unit-sweep-remaining.tsv` — 738 spec files (apps/api + 14 modules), stand-in vitest, cwd = the
package, `NODE_ENV=test`, 180 s each.

| Outcome | Files | Meaning |
|---|---|---|
| PASS | **587** | every `it()` passed |
| self-running specs (`*-core.spec.ts`, print their own tally) | **47** | re-run individually: **all pass** (e.g. `account-core 12/12`, `customer-display-core 30/30`, `reports-core 47/47`, `services-core 55/55`, `super-admin-tenants-core`, `api-webhooks-core 26/26`, `deployments-core 19/19`, `logs-core 16/16`, `service-revenue-core`) — the sweep script simply did not parse their output |
| harness-limited | **104** | need the real runtime: decorator-metadata sweeps over compiled Nest routes (45 — `request-schemas`, `authz-declared`, `strict-bodies`, `realm.guard`, `*-boundary` "is SuperAdminGuard-gated"), real HTTP / SSE servers (8), the real Nest / Kysely runtime where the stand-in stubs it (8 — `NestFactory.create`, `db.getExecutor`, `instanceof HttpException`), PGlite / PostgreSQL seeds (5), and vitest features the stand-in lacks (fake timers → session-lock 8 h, schedulers, burst coalescing; `mockRejectedValue` / `toHaveBeenCalledOnce` / `toMatchSnapshot`; `toMatchObject` with a RegExp; `pngjs` / `exceljs` test fixtures; the process-TZ test) |
| **real defects** | **2** | below — both fixed |

Developer: `npm ci --ignore-scripts && npm run ci:test:api && npm run ci:test:modules` runs all 738 under real vitest
(FST-1); every harness-limited file is expected green there — none of them failed on product logic when read.

### Real defects found by the sweep

1. **Stale Content-Security-Policy hashes — `apps/booking-public/public/_headers`, `apps/go-check-in-kiosk/public/_headers`**
   (`app-headers.vitest.spec` 20/22). The inline bootstrap `<script>` in both `index.html` changed on Oct 28 (English-only
   enforcement, `05ac57cd`) and the generated `_headers` still carried the previous `sha256-…`. On any host that serves
   `_headers` (Cloudflare Pages / Railway static) the browser would have **blocked that script** — the public booking page
   and the kiosk would not bootstrap. Regenerated with `node apps/api/scripts/generate-app-headers.mjs` → 22/22
   (`bfe23c7a`). Rule for the developer: run that generator whenever an `index.html` inline script or style changes (CI's
   `security.yml` runs the spec).
2. **Unreviewed push producer** (`push-producers.vitest.spec` 3/4). The Customer Queue mandate (`5c121c62`) added a
   fourth push in `modules/queue/src/queue/queue.service.ts` — Send Wait Alert, "Your wait update". §61 requires every
   push copy to be reviewed for personal data before it ships. Reviewed: the body carries only the quoted minutes (no name,
   phone, service); added to the reviewed inventory (`bfe23c7a`).

Cosmetic, also fixed: Super Admin → Project Status listed the POS modules under `/pos/<page>`; pos-web serves them at
`/<page>` (Dashboard = `/live-operations`). Display text only (`cf603852`).

## 3. What did NOT run here (unchanged from the Oct 28 full-system test)

Frontend `tsc` (no `@types/react` offline), Vite production builds, ESLint, the 12 environment-bound gates listed in
`TEST_REPORT.md`, jsdom component tests (`*.test.tsx`), branded Chrome / Edge, the physical 27-inch touchscreen, any live
processor or Twilio call. All are FST-1 / FST-7 for the developer with a real `npm ci`.

## 4. Verdict

CODE_READY_FOR_DEVELOPER_HANDOFF = **YES** · PRODUCTION_READY = **NO** (K-12, FST-1 … FST-8 — see
`DEVELOPER_HANDOFF_FINAL_2026-10-28.md`). No module unwired, no dead screen, no unhandled button, no undocumented variable;
two real defects fixed, 12 dead links fixed, 738 more spec files exercised.
