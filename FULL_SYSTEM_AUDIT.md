# FULL SYSTEM AUDIT — AIPowerSalon

Consolidated audit for the data-backed system. Evidence: live execution (see `RUN_LOCAL_EXECUTION_REPORT.md`),
208-test suite, 17 live-Postgres isolation probes, and clean builds of both web apps.

## Canonical repository map
One npm-workspaces monorepo (`aipowersalon-pos/`); each app is the single authoritative implementation — no duplicates.

| App | Path | Framework | Start (dev) | Backend connection |
|-----|------|-----------|-------------|--------------------|
| **API (authoritative backend)** | `apps/api` | NestJS 10 + Kysely + pg | `node apps/api/dist/main.js` (PORT=3000) | owns Postgres; tenant/branch derived from session |
| **POS** | `apps/pos-web` | Vite + React | `vite` :5173 | root-relative `/pos`,`/auth` via dev proxy → API |
| **Super Admin** | `apps/admin-web` | Vite + React | `vite` :5174 | `/super-admin`,`/auth` via dev proxy → API |
| Technician app | `apps/tech-web` | Vite + React | `vite` | same API + client (not in local boot scripts) |
| Customer app | `apps/customer-web` | Vite + React | `vite` | same API + client (not in local boot scripts) |

Migrations: `apps/api/db/migrations` (001–041, 42 files) applied by `apps/api/scripts/migrate.mjs` (idempotent ledger).
Seeds: `seed.ts` (admin + pilot tenant) and `seed-demo.ts` (operational data). All clients share `apps/*/src/api/client.ts`
(root-relative, cookie auth, never sends a tenantId).

## Feature-status matrix

| Capability | Status | Evidence |
|-----------|--------|----------|
| Real authentication + session cookie | ✅ | OWNER login → 200 + `aps_session`; role redirects defined |
| Database persistence | ✅ | `POST /pos/customers` → row in Postgres, read back (5→6) |
| Tenant/branch isolation (server-derived) | ✅ | session-derived scope; `assertNoClientTenant`; isolation probes green |
| Production cannot run on mock data | ✅ | `main.ts` guard refuses to start (exit 1) without `REPO_DRIVER=postgres`+`DATABASE_URL`+`AUTH_SESSION_SECRET` |
| 16 POS sidebar screens → real screens/APIs | ✅ | every route→screen; every client→real `@Controller`; `tsc`+build clean |
| Live Technician Schedule wired | ✅ | imported, routed `/technicians/schedule`, sidebar entry |
| Booking→Check-In→Queue→Serving→Done→Checkout | ✅ | one canonical ticket/appointment record set; verified on live PG |
| Per-tenant payment isolation | ✅ | `tenant_payment_config` (AES-256-GCM), resolver, webhooks, refunds — see `PAYMENT_GATEWAY_AUDIT.md` |
| Checkout totals backend-authoritative (integer cents) | ✅ | subtotal/tip/tax/surcharge/total computed server-side |
| Reports from stored records (tenant-scoped) | ✅ | phantom-revenue bug fixed; server-scoped |
| Settings affect real modules | ✅ | settings module + masked gateway status |
| Realtime | ⚠️ Polling/refetch | refetch-after-mutation; no WebSocket bus yet (documented) |
| Live processor sandbox round-trips | ⛔ Blocked | needs `CARDPOINTE_*`/Stripe/Square/Clover creds; `PAYMENTS_SANDBOX=1` simulates |
| In-browser modal QA across viewports | ⛔ Needs browser | build/type verified; not click-tested in 3 viewports here |
| tech-web / customer-web / native | ◻ Not booted | share backend + API client; outside local boot scripts |

## Tenant-isolation audit
Backend derives `tenantId`/`branchId` from the authenticated session for every normal request; the web client never
sends a tenantId (guarded by `assertNoClientTenant`). Live-Postgres probes drive the REAL repositories and confirm
cross-tenant reads/writes/refunds/webhooks/reports are blocked. The persistence proof showed the created customer's
tenant/branch came from the session, not the request body.

## Build & test
- `npm run build --workspace @aipowersalon/api` → exit 0; `tsc --noEmit && vite build` for pos-web and admin-web → exit 0.
- `npm test` → **208 passed (31 files)**, plus 17 live-PG isolation/workflow probes green and migration 041 txn-tested.

## Remaining blockers (honest)
1. Live card processing — processor sandbox credentials required (external).
2. Exhaustive in-browser modal/viewport QA — requires a desktop browser session.
3. WebSocket/SSE realtime bus — currently refetch-after-mutation; a push bus is future work.
4. tech-web/customer-web/native builds — not exercised in the local scripts.

## Mapping to the requested document set
- SIDEBAR_ROUTE_MAP + CLICK_AND_MODAL_AUDIT → covered by `DOC2_POS_INTEGRATION_AUDIT.md`.
- API_CONNECTION_MAP + DATABASE_MIGRATION_REPORT + CANONICAL_REPOSITORY_MAP + FEATURE_STATUS_MATRIX + TENANT_ISOLATION_AUDIT + BUILD_AND_TEST_REPORT + REMAINING_BLOCKERS → consolidated into this file and `RUN_LOCAL_EXECUTION_REPORT.md`.
- Payment specifics → `PAYMENT_GATEWAY_AUDIT.md`. Per-spec status → `COMPLETION_STATUS.md`.
