# TEST REPORT — Transfer Verification

**Date:** 2026-07-09 · **Scope:** full monorepo verification for chat-to-chat handoff.
**Environment:** Node + project toolchain in-repo (TypeScript 5.4, Vitest, PGlite/PG15 for DB-backed tests).

## Commands executed and results

| Check | Command | Result |
|---|---|---|
| API typecheck | `tsc --noEmit -p tsconfig.json` (apps/api) | **0 errors** |
| API production build | `tsc -p tsconfig.build.json` (apps/api) | **exit 0** |
| API dependency graph | `node scripts/di-check.mjs` | **DI_GRAPH_OK** (all providers resolved, no cycles) |
| API test suite | `vitest run` (apps/api) | **3352 passed / 3352** (511 files) |
| pos-web build | `vite build` (apps/pos-web) | **exit 0** (~6s) |
| pos-web test suite | `vitest run` (apps/pos-web) | **414 passed / 414** |
| Sidebar↔route wiring invariant | `vitest run src/shell/tenant-nav.wiring.test.ts` | **7 / 7** |
| Migration chain (queue-assignment 331–335) | PGlite fresh-apply | **clean → 7 tables** |
| Secret scan (source) | heuristic grep for live keys / private keys / inline passwords | **none found** |
| Bare `.env` files | `find` (non-example/template) | **none** (only `*.example` / `*.template`) |

## Tenant-isolation / authorization checks

- The platform-wide static isolation invariant (`src/common/tenant-isolation.vitest.spec.ts`) **passes**: no unscoped raw-SQL tenant-table query in tenant-facing code outside the documented allowlist.
- Three super-admin oversight aggregates (voice-transcription status/provider rollups, money-protection severity rollup) were reconciled into the statement allowlist with individual justifications — they are counts-only, reached via `SuperAdminGuard` surfaces, and each repo's tenant-facing queries remain `tenant_id`-scoped.
- Role/permission and tenant-isolation behavior is covered by the passing suites above (RBAC guards, `SuperAdminGuard`, tenant-scoped repositories).

## Fixes applied this session (see CHANGELOG_HANDOFF.md)

1. **Duplicate AI package removed.** A second queue package (`ai_queue_assignment`) had been introduced alongside the pre-existing `ai_queue_technician_assignment`. The new AI Queue Assignment implementation was **unified onto the existing package code** (entitlement, usage logging, super-admin usage filter, and the pos-web nav entitlement gate all repointed); the duplicate catalog entry and the extra usage-unit were reverted. This restored the "exactly 15 packages" invariants, plan-coverage, and prompt-coverage tests.
2. **Isolation allowlist reconciled** for the three super-admin count rollups noted above.

Net effect: the full API suite moved from **6 failing to 0 failing** (3352/3352), with no invariant weakened.

## What was NOT independently verified (honest gaps)

- **Fresh `npm install` from a clean clone** was not run here (the working tree already had installed dependencies). The lockfile (`package-lock.json`) is included so a clean install is deterministic, but first-install success on the target machine should be confirmed there.
- **Running servers end-to-end** (live backend + frontend against a real Postgres, real auth login, browser tenant switching) was not performed; verification is via the project's automated suites, type/build gates, and DB-backed tests (PGlite). The repo's existing `BROWSER_TEST_CHECKLIST.md` / `FULL_POS_BROWSER_TEST_AUDIT.md` cover manual flows.
- Only `apps/api` and `apps/pos-web` suites were executed in full. The other frontends (`admin-web`, `owner-web`, `tech-web`, `customer-web`, `customer-display`, `go-check-in-*`, `manager-pay-web`) are part of the repo but their individual suites were not run this session; run them on the target machine before shipping changes there.
