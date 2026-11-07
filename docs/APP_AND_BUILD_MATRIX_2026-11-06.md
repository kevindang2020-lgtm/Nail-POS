# App matrix and build matrix — Nov 6 2026, on the branch HEAD (`merge-github-main`)

This covers F5 §251 (app matrix) and §252 (build matrix). It records only what was run today, on this code. Anything not run
says so.

## Build matrix

| Step | Command | Result |
|---|---|---|
| Install | workspace `node_modules` already present | not re-run |
| Typecheck | `npm run typecheck` | rc 0 |
| Packages + modules | `npm run -s build` in every changed package and module (api-contracts, database, permissions, workforce, queue, customers, reports, ai, analytics) | rc 0 |
| API | `apps/api npm run -s build` | rc 0 |
| Frontends | `npm run -s build:frontends` (all Vite SPAs) | rc 0 |
| Gates | every `apps/api` `check:*` script (`/tmp/allchecks.sh`; `check:ai-dod` included) | 0 failed on the last full run before migration 833; re-run after 833 — see `TEST_REPORT` / the commit |
| Lint | `check:lint` (lint-ratchet) | 0 errors, 0 warnings |
| Migrations | `scripts/migrate.mjs` on the local `aps` database | 771 applied (through 833) |
| Concurrency | `*.postgres-race.vitest` suites in the modules touched today | passed in the module runs below |
| Mobile native builds | — | BLOCKED_EXTERNAL (store keys, a Mac) |

## App matrix

| App | Tests run today | Result | Build |
|---|---|---|---|
| pos-web | full suite | 383 files · **2,084 / 2,084** | rc 0 |
| admin-web | full suite | 180 files · **1,070 / 1,070** | rc 0 |
| owner-web | full suite | 67 files · **374 / 374** | rc 0 |
| customer-web | full suite | 67 files · **286 / 286** | rc 0 |
| tech-web | full suite | 41 files · **205 / 205** | rc 0 |
| customer-display | full suite | 22 files · **205 / 205** | rc 0 |
| manager-pay-web | full suite | 20 files · **121 / 121** | rc 0 |
| go-check-in-kiosk | full suite | 3 files · **8 / 8** | rc 0 |
| booking-public | none (the app has no test files) | — | rc 0 |
| API (modules) | the suites of every module changed today: ai (`voice-booking`, `ai-center` 522), customers (referrals / retention / reviews 117), reports birthdays (21), workforce (79), queue tech (192), analytics ai-business (150, earlier today) | all passed | rc 0 |

**Not run today:**

- The full API lane across every module.
- The pilot day.
- The live proofs.

The last full run is in `docs/pilot-runs/2026-11-06-full/FINDINGS.md` (pilot 236/236 at `835b58e`). It predates today's Batch A
and F5 work.
