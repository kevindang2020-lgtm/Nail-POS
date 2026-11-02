# AIPowerSalon — Full Wiring & Test Verification (2026-07-06)

Deep scan of the entire monorepo: module wiring, tests, builds, and frontend↔backend wiring.
Result: **all modules wired, all suites green, all apps build.**

## Backend — apps/api
| Check | Result |
|---|---|
| DI graph (NestFactory.create(AppModule)) | **DI_GRAPH_OK** — every provider resolves, no missing deps / cycles |
| Migrations (fresh DB, in order) | **319 / 319 applied, 0 failures** |
| TypeScript (tsc --noEmit) | **0 errors** |
| Production build | **clean** |
| Controllers wired | **172** |
| Test suite | **467 files · 3013 tests · all pass** |

## Frontends — TypeScript apps (all tsc 0, all build clean, all tests pass)
| App | Tests | tsc | build |
|---|---|---|---|
| pos-web | 332 | 0 | ✓ |
| admin-web | 732 | 0 | ✓ |
| owner-web | 175 | 0 | ✓ |
| tech-web | 86 | 0 | ✓ |
| customer-web | 149 | 0 | ✓ |
| customer-display | 30 | 0 | ✓ |
| manager-pay-web | 26 | 0 | ✓ |
| **Frontend total** | **1530** | | |

Native wrappers (Capacitor, single index.html — no TypeScript): go-check-in-kiosk, go-check-in-admin — build ok.

## Frontend ↔ Backend wiring
- Every API root the frontends call maps to a live backend controller.
  Roots exercised: ai, auth, customer, integrations, me, mobile-checkout, owner, pos,
  public, push, realtime, super-admin, tech, technician, tenant.
- Global search: verified on real Postgres across all 7 groups (customers, technicians,
  appointments, queue, tickets, receipts, services) — every group returns results AND is
  tenant-isolated (SEARCH_ALL_OK; identical-named tenant B data never leaks to tenant A).

## Grand total
**4,543 automated tests passing** (3013 backend + 1530 frontend) · 9 apps build · DI graph resolves ·
319 migrations apply · frontend/backend API roots fully matched.

## Honest scope notes
- The frontend↔backend cross-check matches API *roots* to controllers; individual endpoint
  paths are covered by the 3013 backend tests + tsc, not an exhaustive path-by-path diff.
- Verification is compile + unit/integration + real-Postgres query checks. It does not include
  a live end-to-end run through HTTP auth guards with real sessions (covered by guard unit tests).

## Live end-to-end run (booted API through real HTTP + auth guards)
Booted `node dist/main.js` against real Postgres (2 seeded tenants) and hit `/pos/search`:
| Request | Result |
|---|---|
| No session cookie | **HTTP 401** — TenantAuthGuard rejects |
| Tenant A session (minted aps_session) | **HTTP 200** — sees only "ZephyrE2E A" |
| Tenant B session | **HTTP 200** — sees only "ZephyrE2E B" |

**E2E_SEARCH_OK** — full path proven live: cookie → TenantAuthGuard → RolePermissionGuard →
controller → service → repo → Postgres, with tenant isolation intact end-to-end.
Harness: scripts/e2e-search.mjs. This closes the earlier "no live HTTP auth path" caveat.

## Live E2E smoke — key endpoints through real guards (single boot)
| Endpoint | anon | authed tenant |
|---|---|---|
| GET /pos/search | 401 | 200 |
| GET /pos/overview/state | 401 | 200 |
| GET /pos/overview/board | 401 | 200 |
| GET /pos/queue/state | 401 | 200 |
| GET /pos/checkout/state | 401 | 200 |
| GET /pos/technicians/live-schedule/state | 401 | 200 |

**E2E_SMOKE_OK** — every key endpoint rejects anonymous requests and serves an authenticated
tenant through the real TenantAuthGuard + RolePermissionGuard.
Reusable runner: `sh apps/api/scripts/run-e2e.sh` (seed → boot → e2e-search + e2e-smoke → teardown).

## Silent-failure bug hunt (table + column classes)
- **Table class:** cross-checked all 177 tables referenced in code against the 448 real tables → **0 missing**. Removed the phantom `AppointmentsTable` type so `selectFrom('appointments')` is now a compile error (root cause of the earlier appointments bugs).
- **Column class:** extracted column literals from `.where` / `.select` / `.orderBy` / `.groupBy` across the API and matched against all 5,758 real (table, column) pairs. After excluding the 160 defined `.as()` aliases, the remaining flags were all verified false positives (real tables referenced in subqueries, or status-value string literals like `'under_review'`). **No query references a non-existent column.**
- Conclusion: the table/column silent-failure bug class is clean; the one historical instance (appointments) is fixed and now prevented at compile time.
