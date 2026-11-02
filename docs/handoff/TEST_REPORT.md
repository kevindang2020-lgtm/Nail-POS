# TEST_REPORT — AI PowerSalon

Date: 2026-06-26. All commands below were actually executed in the working tree; numbers are real.

## Environment
- Monorepo: npm workspaces. Backend: NestJS + Kysely + Postgres 16. Frontends: Vite + React.
- No live Postgres in the verification environment → SQL/transactional paths are exercised by a
  DB-free harness + mocked/in-memory adapters, NOT by a live database. See "Deferred" below.

## Type checks (`tsc --noEmit`)
| Target | Result |
|--------|--------|
| apps/api | 0 errors |
| apps/pos-web | 0 errors |
| apps/admin-web | 0 errors |
| apps/owner-web | 0 errors |
| apps/tech-web | 0 errors |
| apps/customer-web | 0 errors |
| apps/customer-display | 0 errors |

(go-check-in-kiosk / go-check-in-admin are Capacitor/static wrappers with no TS source to typecheck.)

## Backend test suite (`bash scripts/run-core-specs.sh`)
- Pure-core harness suites: **65 passed, 0 failed**
- Vitest: **138 files / 873 tests passed**
- RESULT: **PASS**

## pos-web
- Vitest: **51 files / 139 tests passed**
- `vite build`: **success**

## What the tests cover (representative, not exhaustive)
- Multi-tenant isolation: 14 vitest specs assert tenant A cannot read/update/search tenant B's data
  (in-memory adapters are seeded for one tenant only, so isolation is provable).
- Money path: check-in → checkout → payment chain, integer-cent arithmetic, split-tender, surcharge,
  idempotent card replay, concurrent-capture race, over-refund advisory-lock.
- Webhooks: SSRF URL guard, encrypted signing secret, HMAC-SHA256 signed delivery, retry/backoff
  state machine, event dispatcher (plan → enqueue → deliver → retry → dead), delivery ledger.
- Devices & Integrations: overview aggregate, deployments state machine, event-log store + producers.

## Deferred / blocked (honest)
1. **Live Postgres** — `npm run db:up && npm run db:setup` was NOT run (no database in this env).
   Migrations 001–138 (incl. 134 api-keys/webhooks, 135 deployments, 136 event-logs, 137 webhook-
   deliveries) are verified by tsc + harness + mocked tests only. Run a live smoke before relying
   on transactional behavior.
2. **End-to-end / running-server / security scan against a live instance** — not run (no running
   API + DB). Logic-level equivalents are covered by the unit/integration suites above.
3. **Webhook async scheduler** — `processDue` is built and tested and exposed at POST /pos/webhooks/process;
   the periodic cron/queue worker that calls it on an interval is environment-gated and not wired.
4. **Visual/pixel QA** — no 24" iMac @1920×1080/100% pass on the Devices & Integrations screens.
