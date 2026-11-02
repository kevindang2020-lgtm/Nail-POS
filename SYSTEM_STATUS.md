# SYSTEM_STATUS.md — apps, services, versions, environment, actual health (FullSystemTest.pdf §89, §94, Appendix D)

| | |
|---|---|
| Date | 2026-10-28 |
| Branch / commit | `merge-github-main` · code `07e599ea` (docs / tooling commit on top) · `origin` is a local bundle; nothing pushed |
| DB migration head | `706_ai_receptionist_english_only.sql` (646 files) |
| Environment | Anthropic cloud sandbox · Linux 6.18 x86_64 · **2 vCPU** · Node **22.23.4** · PostgreSQL **16.15** (local cluster on 127.0.0.1:55432 / socket, `wal_level=replica`, WAL archiving on) · Redis 7.0.15 binary present (not started) · Docker client only (no daemon) |
| Toolchain limits | **No npm registry** (requests fail before reaching it): `node_modules` has no TypeScript, Kysely, NestJS, vitest, vite, React, `pg`, PGlite. TypeScript **6.0.2** taken from the offline npm cache (repo pins **5.4.5**) and linked into the git-ignored `node_modules/typescript` |
| Services started | PostgreSQL 16 only. The API, workers, realtime and the web apps **could not be started** (their dependencies are not installed) |

## 1. Applications and services

| App / service | Version | Path | Start / build here | Health this run |
|---|---|---|---|---|
| API (HTTP, REST, SSE realtime) | 1.0.0 | `apps/api` | BLOCKED_DEPENDENCY (no NestJS / `pg`) | gates PASS (route manifest 3,123 routes valid, `check:openapi`); not booted |
| Workers (`PROCESS_ROLE=worker`, outbox, sweeps, schedulers) | (API) | `apps/api/src/worker.ts` | BLOCKED_DEPENDENCY | not booted |
| Front Desk POS (EN + VI) | 0.1.0 | `apps/pos-web` | BLOCKED_DEPENDENCY (no vite / React) | `pos-i18n` PASS (every POS text behind `t()`), `vi-glossary` PASS, syntax PASS |
| Super Admin (English only) | 0.1.0 | `apps/admin-web` | BLOCKED_DEPENDENCY | `admin-english-only` PASS; owner-PIN generator fixed (`2ca43279`) |
| Owner App (English only) | 1.6.0 | `apps/owner-web` | BLOCKED_DEPENDENCY | `english-only-apps` PASS |
| Technician App (English only) | 1.6.0 | `apps/tech-web` | BLOCKED_DEPENDENCY | `english-only-apps` PASS |
| Customer App (English only) | 1.6.0 | `apps/customer-web` | BLOCKED_DEPENDENCY | `english-only-apps` PASS |
| Tap to Pay / Manager Pay (English only) | 1.0.0 | `apps/manager-pay-web` | BLOCKED_DEPENDENCY | `english-only-apps` PASS |
| Customer Display (English only) | 0.1.0 | `apps/customer-display` | BLOCKED_DEPENDENCY | `english-only-apps` PASS |
| Go Check-In kiosk | 0.1.0 | `apps/go-check-in-kiosk` | plain HTML | `english-only-apps` PASS |
| Online booking page | — | `apps/booking-public` | plain HTML | `english-only-apps` PASS |
| PostgreSQL 16 | 16.15 | local | **running** | 646 / 646 migrations, integrity + concurrency + RLS 22 / 22, backup / PITR drill PASS |
| Native shells (Capacitor iOS / Android) | — | `apps/*/android`, `apps/*/ios` | BLOCKED_EXTERNAL (Mac, Xcode, signing) | `mobile versions`, `mobile native config`, `gradle wrapper` gates PASS |

## 2. Proof matrix per app (§94) — this commit

Legend: P = PASS, F = FAIL, NT = NOT_TESTED, BD = BLOCKED_DEPENDENCY (no npm packages here), BE = BLOCKED_EXTERNAL, — = not applicable.
"Last" = the last time it was executed, when not today.

| App | BUILD | TYPECHECK | LINT | UNIT | INTEGRATION | E2E | AUTHZ | TENANT | REALTIME | PERFORMANCE | EXTERNAL UAT |
|---|---|---|---|---|---|---|---|---|---|---|---|
| API + modules | BD | partial P ¹ | BD | partial P ² | DB-level P ³ · pgtests BD | NT (last P Oct 27) | gates P ⁴ · suites BD | DB RLS P · app gates P · API probes NT | NT (last P Oct 27) | NT (last Oct 24/27) | BE |
| POS | BD | BD | BD | BD (jsdom) | — | NT (last P Oct 27) | — | — | NT | NT (last Oct 24) | — |
| Super Admin | BD | BD | BD | BD | — | NT | — | — | — | NT | — |
| Owner / Tech / Customer / Tap to Pay apps | BD | BD | BD | BD (jsdom); i18n policy P (static gate) | — | NT (last P Oct 27, Tech App at 390×844) | — | — | NT | NT | BE (devices, stores, Tap to Pay) |
| Customer Display | BD | BD | BD | BD | — | NT (last P: 3,006 ms clear) | — | — | NT | — | BE (tablet) |
| Database | — | — | — | — | P (`db-races.sh` 22 / 22, negative control 8 F) | — | P (RLS) | P | — | migrations 2 m 0 s | BE (production restore) |

¹ All 6,912 `.ts` / `.tsx` sources parse (TypeScript 6 parser). Whole-backend type-check of 2,800 files with untyped stand-ins
for the 47 missing third-party modules: **0 errors in the repository's own types**; every one of its errors comes from an untyped
package (details `TEST_RESULTS.md` §3). `packages/api-contracts` type-checks **strictly with 0 errors** (TS 6.0.2).
² Unit sweep through the stand-in harness (Node strip-types + a vitest shim): see `TEST_RESULTS.md` §4 for the counts.
³ `DATABASE_AUDIT.md` §3. ⁴ `check:role-checks`, `check:perms`, `check:permission-docs`, `check:tenant`, `check:tenant-builder`,
`check:response-exposure`, `check:attack-surface` and the others in `TEST_RESULTS.md` §1.

## 3. Open P0 / P1 / P2 / P3 (summary — details in `NEXT_STEPS.md`, `SECURITY_REMAINING_ACTIONS.md`)

| Severity | Open | Items |
|---|---|---|
| P0 | 3 | P0-1 K-12 incident sequence · P0-2 real MID UAT · P0-3 V-28 verification of the 103 commits since Oct 27 (typecheck / suites / race / pilot) |
| P1 | 4 | production restore + PITR on the real host · penetration test · RLS flags in production (S-RLS) · edge / hosting settings S-B2 … S-B7 |
| P2 | 6 | Tap to Pay provider + devices · Twilio A2P / SendGrid / push · OCR bucket + scanner + Textract · native builds / stores · 27-inch EN / VI layout re-run · busy-state responsive report 55 / 90 (I-18) |
| P3 | 3 | lint ratchets / `as any` 3,251 (I-15) · dead-code batch 2 (I-14) · NEXT_STEPS doc path error (I-2 evidence folder) — fixed in this commit's docs |

Verdicts: `PRODUCTION_READINESS.md` — **CODE_READY_FOR_DEVELOPER_HANDOFF = YES · PRODUCTION_READY = NO**.
