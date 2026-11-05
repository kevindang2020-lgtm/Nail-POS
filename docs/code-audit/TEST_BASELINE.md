# TEST_BASELINE

## Re-verified 2026-06-22 (authoritative, full sweep run)
- Typecheck (`tsc --noEmit`) across **all 7 real apps**: **clean, 0 TS errors**.
- vitest across all 7 apps: **280 files / 1,356 tests passing, 0 failures**.
- `apps/api` also has **43** Nest-free `*-core.spec.ts` files (run via `npm test` → `scripts/run-core-specs.sh`): **all 43 pass**.
- Production builds across all 7 apps: **0 failures**.

| Suite | Files | Tests |
|---|---|---|
| api | 112 | 733 |
| admin-web | 50 | 191 |
| customer-web | 42 | 136 |
| pos-web | 41 | 107 |
| owner-web | 18 | 85 |
| tech-web | 14 | 74 |
| customer-display | 3 | 30 |
| **Total** | **280** | **1,356** |

Plus api **43** `*-core.spec.ts` (pure-logic) all green. End-to-end money path (check-in → paid) verified live this pass — see `CHANGELOG_CODEBASE_REPAIR.md`.

> Prior baseline on this file read api 661/99 + ~1,200 workspace tests; refreshed above to the current grown codebase.

## Live-Postgres verifications (this session, port 5433 / `aipowersalon`)
Card claim-first single-winner; split `payment_attempts` unique reservation; gift-card atomic decrement; wallet advisory-lock overdraft block; **atomic refund cap** (reserve counts toward cap, release frees it). All passed.

## How to re-run
- Root install first: `npm install --no-audit --no-fund`.
- api: `cd apps/api && ../../node_modules/.bin/tsc --noEmit -p tsconfig.json && node_modules/.bin/vitest run`.
- Each frontend: `cd apps/<app> && ../../node_modules/.bin/tsc --noEmit -p tsconfig.json && ../../node_modules/.bin/vite build && ../../node_modules/.bin/vitest run`.
- Core specs: `bash scripts/run-core-specs.sh`.
