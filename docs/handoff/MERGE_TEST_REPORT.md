# MERGE_TEST_REPORT.md — real verification of the merged monorepo (2026-06-26)

All commands below were **actually run** against the merged tree in this environment. Output is
transcribed (trimmed to the result lines). Nothing here is a claim copied from the input archives.

## Environment

- Node + npm workspaces monorepo; `npm install` at root.
- **No live Postgres** in this environment → DB-backed transactional paths are exercised by the DB-free
  harness and mocked repositories only (see "Not run / blocked" below).

## Install

```
$ cd <repo> && npm install --no-audit --no-fund
added 617 packages in 18s
```
Result: **OK** (one benign deprecation warning for a transitive dep `whatwg-encoding`).

## TypeScript — all 7 apps, 0 errors

```
$ cd apps/api          && npx tsc --noEmit      # exit 0
$ cd apps/admin-web    && npx tsc --noEmit      # exit 0
$ cd apps/pos-web      && npx tsc --noEmit      # exit 0
$ cd apps/owner-web    && npx tsc --noEmit      # exit 0
$ cd apps/tech-web     && npx tsc --noEmit      # exit 0
$ cd apps/customer-web && npx tsc --noEmit      # exit 0
$ cd apps/customer-display && npx tsc --noEmit  # exit 0
```
Result: **0 errors across all seven workspaces.** This is the key proof that V1's
`super-admin-platform` + `reminders` and V2's full operational pipeline + the three utility modules
compile together against the single merged `kysely.types.ts`.

## API — DB-free harness + vitest

```
$ bash scripts/run-core-specs.sh
...
Harness suites: 57 passed, 0 failed
 Test Files  134 passed (134)
      Tests  849 passed (849)
RESULT: PASS
```
Result: **PASS.** The 57 harness suites include the 17 V1 super-admin core specs
(`invite-user-core`, `customer-merge-core`, `product-category-merge-core`, `users-dashboard-core`,
`session-revocation-core`, `user-mfa-core`, …) **and** V2's pipeline specs; the 849 vitest tests include
V2's analytics specs (`kpi-snapshots`, `tech-utilization`, `checkout-upsell-mix`, `checkout-staff-rows`,
`service-done-rebooking-suggestion`, `queue-*`, …). The harness script exits non-zero if any single core
suite fails, so the `RESULT: PASS` / exit 0 guarantees all 57 passed.

## Frontend vitest

```
$ cd apps/admin-web && npx vitest run
 Test Files  51 passed (51)
      Tests  211 passed (211)

$ cd apps/pos-web && npx vitest run
 Test Files  48 passed (48)
      Tests  129 passed (129)
```
Result: **PASS** — exactly matching each source branch's own counts, i.e. the merge preserved every
frontend test in both halves.

## Production builds

```
$ npm run build --workspace @aipowersalon/api          # tsc -p tsconfig.build.json → exit 0
$ npm run build --workspace aipowersalon-pos-web        # vite build → ✓ built in 4.32s
$ npm run build --workspace aipowersalon-admin-web      # vite build → ✓ built in 4.05s
```
Result: **all OK.** Both Vite builds print a "chunks larger than 500 kB" advisory — this is a
performance suggestion, not an error, and is identical to the inputs' build behaviour.

## Static / structural checks (also run)

- Migration prefixes: **133 `.sql` files, all prefixes unique**, latest `132_queue_requested_technician.sql`;
  the seven new migrations (126–132) all present.
- `kysely.types.ts` union present: `line_kind`, `requested_technician_id`, `PosKpiDailySnapshotsTable`,
  `pos_kpi_daily_snapshots`.
- All 10 utility-module imports (`../tech-utilization/…`, `../tech-recommendation/…`,
  `../kpi-snapshots/…`) resolve to real files.
- Every `./screens/*` import in `admin-web/src/App.tsx` resolves to a present file.
- Intentional drops confirmed absent: `ProductsScreen.tsx`, `AppointmentsScreen.tsx`, `techAppApi.ts`,
  `_probe.mjs`.
- Secret scan over both source trees and the merged tree: **no committed secrets, no raw `.env`.**

## Aggregate

| Suite | Files | Tests | Status |
|---|---|---|---|
| API vitest | 134 | 849 | PASS |
| admin-web vitest | 51 | 211 | PASS |
| pos-web vitest | 48 | 129 | PASS |
| API DB-free harness | — | 57 suites | PASS |
| 7× `tsc --noEmit` | — | — | 0 errors |
| 3× build (api/pos/admin) | — | — | OK |

**Total executed: 1,189 vitest tests + 57 harness suites, all green; 7 typechecks clean; 3 builds clean.**

## Not run / blocked in this environment (honest gaps)

| Item | Why | Exact command to run with a real environment |
|---|---|---|
| Live migration apply (000–132) incl. new 126–132 | No live Postgres in sandbox | `npm run db:up && npm run db:setup` |
| Transactional behaviour of new tables (kpi snapshots, category-merge logs, privacy requests, reminder attempts, requested-technician, line_kind) | Needs applied schema | run the live smoke above, then `npm run e2e:workflow` |
| owner-web / tech-web / customer-web / customer-display **vitest** + **build** | Time-boxed this pass; only typechecked (0 errors) | `cd apps/<app> && npx vitest run && npm run build` |
| ESLint full pass | Time-boxed | `npm run lint` |
| Payment / Twilio / OpenAI / FCM live calls | Require real credentials (see `ENVIRONMENT_VARIABLES.md`); stubbed in dev | provide credentials, then exercise the relevant flows |
| Real-time (WebSocket) cross-tenant isolation E2E | Needs a running API + two tenant sessions | start `npm run dev:api`, drive two authenticated clients |

These gaps are identical in nature to what both input branches already documented; the merge does not
introduce new blockers.
