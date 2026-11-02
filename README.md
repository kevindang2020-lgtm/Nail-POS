# AI PowerSalon

> **Oct 10 2026:** the current developer entry point is `START-HERE.md` (build, run, test, deploy, doc map, Kevin's actions). Figures in this file (controller / route / migration counts) are from July 2026; current counts: `API_INVENTORY.md` (generated) and `apps/api/db/migrations`.

Multi-tenant SaaS for nail salons. One platform, many salon businesses — each with its own branches, staff,
customers, bookings, POS, payments, payroll/commission, marketing, and AI features — plus a platform-level
Super Admin console and a Fiserv revenue-share model.

**Taking over as a developer? Read `DEVELOPER_HANDOFF.md` first.** It is the front door to everything below.

## Stack
| Layer | Technology |
|---|---|
| Backend | NestJS 10 · TypeScript 5.4 · Kysely 0.27 · PostgreSQL 16 |
| Frontends | React 18 · Vite 5 (8 workspaces) + 2 single-file HTML kiosk apps |
| Native shells | Capacitor 8 (customer / tech / owner / manager-pay) |
| Tests | Vitest (+ PGlite for real-Postgres-semantics DB tests) · Playwright harnesses |
| Runtime | Node 22 · npm workspaces |

## Applications (10)
`apps/api` (the one backend — 265 controllers / 2,281 routes) · `pos-web` (tenant POS, 27" touchscreen) ·
`admin-web` (Super Admin) · `owner-web` · `tech-web` · `customer-web` · `manager-pay-web` (Tap to Pay) ·
`customer-display` · `go-check-in-kiosk` (HTML kiosk; its devices are managed in admin-web → Check-In Devices — the standalone `go-check-in-admin` page was removed Oct 10 2026). Shared UI: `packages/ui`.
Marketing site (WordPress) ships separately under `marketing/`.

## Quick start
```
npm install
npm run db:up && npm run db:migrate && npm run db:seed
npm run build && npm run dev:api        # API on :3000
npm run dev:pos                          # + dev:admin, dev:owner, dev:tech, dev:customer, dev:managerpay
```
Full walkthrough + seed logins: `LOCAL_DEVELOPMENT.md`.

## Documentation (canonical set)
Start: `DEVELOPER_HANDOFF.md` → status `PROJECT_STATUS.md` → work `REMAINING_WORK.md` + `DEVELOPER_TASKS.md`.
Architecture: `ARCHITECTURE.md` · `DATABASE_ARCHITECTURE.md` · `API_INVENTORY.md` (generated) ·
`AUTH_AND_SECURITY.md` · `PAYMENTS_INTEGRATION.md`. Operations: `LOCAL_DEVELOPMENT.md` · `DEPLOYMENT.md` ·
`SECRETS_REQUIRED.md` · `PUSH_TO_GITHUB.md`. Honesty set: `KNOWN_ISSUES.md` · `FRONTEND_BACKEND_GAPS.md` ·
`TEST_REPORT.md` · `ENGINEERING_RULES.md`. Database depth: `DB_ERD_AND_DOMAINS.md` (generated) ·
`DB_INDEX_AUDIT.md` · `DB_TRANSACTIONS_AND_CONCURRENCY.md` · `DB_PARTITIONING_READINESS.md` ·
`DB_ENTERPRISE_VERIFICATION_REPORT.md`. Index of everything incl. the ~380 preserved historical reports:
`HANDOFF_MANIFEST.md`.

## Development commands
All real scripts live in the root `package.json` (quoted in LOCAL_DEVELOPMENT.md). The ones you'll use daily:
`dev:api`, `dev:pos`, `dev:admin`, `db:migrate`, `test`, `security:fast`, and the 15 gates via
`npm run check:<gate>` in `apps/api` (di sql crosswire dead-client unreached perms public nav types-drift
tenant dialogs money html no-print boot).
Booking: customer-web → Book (customer account) and `apps/booking-public` (NO login — signed link) — see `BOOKING_PAGE.md`. (The single-file `apps/booking-html` and `apps/booking-schedule-html` pages were removed Oct 10 2026; recover from git `62a1875d` if ever needed.)

## Testing
API: `cd apps/api && npx vitest run --shard=N/8` (sum 8 shards — currently **6,091 passed + 4 skipped, 0
failed**) · migrations `node scripts/verify-migrations-pglite.mjs` (**432/432**) · live harnesses
`auth-matrix-e2e.mjs` (13) and `npm run e2e:html` (13). Frontends: `npx vitest run` per app. Numbers +
provenance: `TEST_REPORT.md`. Rule: green before and after every change.

## Deployment
Nothing is hosted yet — deliberately (owner decision pending). `DEPLOYMENT.md` is the canonical reference;
`PUSH_TO_GITHUB.md` covers activating the security CI. A push is not a deploy.

## Current status
Feature-complete against every written spec; every remaining item is credential-, hardware-, hosting-, or
decision-gated (owner-side). Verified numbers and evidence: `PROJECT_STATUS.md` (Jul 30, 2026).

## Developer handoff
This repository IS the handoff package: `DEVELOPER_HANDOFF.md` (start) → `DEVELOPER_TASKS.md` APS-001.
Preserve project history: the dated reports at root are the project's memory — never delete them
(`HANDOFF_MANIFEST.md` explains the policy).
