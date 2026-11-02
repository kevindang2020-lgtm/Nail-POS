# PRODUCTION_READINESS.md — the two verdicts (FullSystemTest.pdf, Oct 28 2026)

| | |
|---|---|
| Date | 2026-10-28 |
| Branch / commit tested | `merge-github-main`, code at `07e599ea` (+ the docs / tooling commit that adds this file) |
| Environment | Anthropic cloud sandbox, Linux x86_64, 2 vCPU, Node 22.23.4, PostgreSQL 16.15 (local cluster, port 55432), TypeScript 6.0.2 from the offline npm cache (the repo pins 5.4.5). **No npm registry access → no `node_modules`** (no NestJS, Kysely, vitest, vite, React, pg, PGlite). |
| Evidence folder | `docs/full-system-test/2026-10-28/` (logs) · scripts `tooling/full-system-test/` |
| Statuses | PASS / FAIL / NOT_TESTED / BLOCKED_EXTERNAL / BLOCKED_DEPENDENCY, as defined by the mandate |

## CODE_READY_FOR_DEVELOPER_HANDOFF: **YES**

The mandate's test: *safe, reproducible code and documented open work.*

| Gate | Result | Evidence |
|---|---|---|
| The schema builds from zero on real PostgreSQL 16, and a second run is a no-op | PASS | 646 / 646 migrations (head `706`) in 2 min 0 s; re-run applied 0; 0 invalid indexes, 0 unvalidated constraints — `docs/full-system-test/2026-10-28/migrations-pg16.log`, `DATABASE_AUDIT.md` |
| The repository gates that this environment can run | PASS | **72 of 78 gates PASS**: 66 in `run-gates.mjs` (incl. `permission-docs`, `async-exports`, `openapi`, `error-text`, `pos-i18n`, unblocked by building two dependency-free packages with TypeScript 6) + its 6 database gates on real PostgreSQL. 6 stay BLOCKED_DEPENDENCY (lint, api-contract, strict-bodies-types, architecture tests' TS-6 deprecation line, frontend builds, app types). One real regression found and fixed (`error-text`). `TEST_RESULTS.md` §1 |
| Database money / booking / audit / payroll invariants under concurrency | PASS | 22 / 22, and the negative control (protections removed) fails 8 — `db-races.log`, `db-races-negative-control.log` |
| Backup → restore and point-in-time recovery | PASS (local drill) | logical restore identical (checksums); PITR to a timestamp drops the later rows and the bad payment edit — `backup-drill.log` |
| Every TypeScript source parses; repo-internal types are consistent | PASS (partial) | 6,912 / 6,912 files parse with the TypeScript 6 parser; a whole-backend type-check (2,800 files) with the missing third-party packages as untyped modules finds **0 errors in the repository's own types** — every one of its errors traces to an untyped package (`TEST_RESULTS.md` §3). Code typed by Kysely / Nest / Express is **not** verified by this. |
| Unit tests that can run without the npm packages | PASS (partial) | stand-in harness (Node strip-types + vitest shim + real-PG PGlite): 1,013 of 2,180 `.ts` spec files — every money / integrity module and every package first — **681 files fully PASS, 6,966 tests passed**; every other failure traced to the stand-in (Kysely stub, Nest metadata, jsdom globals, fake timers). It found and fixed 4 broken spec imports and a fail-open WebAuthn check (`42f77325`, `07e599ea`) — `TEST_RESULTS.md` §4 |
| Open work is written down with paths, owners and the first commands | PASS | `NEXT_STEPS.md` (V-28 first), `SECURITY_REMAINING_ACTIONS.md`, `EXTERNAL_SETUP_CHECKLIST.md` |

**Why YES and not NO:** a developer who takes this branch can reproduce the database, the gates and the drills from the
scripts in the repository, and knows exactly what to run first. **What YES does not mean:** that the code compiles under the
pinned toolchain or that the suites pass on this commit — those were last proven on Oct 27 (`22a98978`: 19,281 unit / PGlite,
race 336, pilot 235 / 235) and **103 commits** (1,042 files) landed after that, including the removal of 1,703 `as any` casts
whose own commit says "NOT YET VERIFIED: `npm run typecheck`". The first developer action (V-28) is that verification.

## PRODUCTION_READY: **NO**

Any unresolved P0 makes this NO (mandate §82). Gate reasons, each with its owner:

| # | Gate | Status | Owner | Why it blocks |
|---|---|---|---|---|
| P0-1 / S-B1 | K-12 incident sequence (rebuild the machine, rotate every credential, revoke the Firebase key, new Play upload keys, new DB password + close port 5432, push the rewritten history, drop `continue-on-error` on gitleaks) | NOT_TESTED / OWNER_ACTION | Kevin's developer | credentials that were exposed are still valid until rotated; the published history still carries them |
| P0-2 | Real CardPointe merchant (per-salon MID) + $1 UAT sale → void + refund inquiry | BLOCKED_EXTERNAL | Kevin + Fiserv | live card processing has only been proven against the loopback / sandbox fake |
| P0-3 (this run) | Typecheck, unit / integration suites, race lane, frontend builds and the full pilot on **this** commit | BLOCKED_DEPENDENCY (npm registry) | developer (V-28) | 103 unverified commits, several on payment paths (Tap to Pay MID routing `e574752d`, Tap to Pay refunds `33034f61`, strict bodies on 1,245 routes) |
| P1 | Production backup restore + PITR on the real hosting (RPO / RTO measured there), and recovery with Super Admin unavailable | BLOCKED_EXTERNAL | Kevin (hosting) | only a local drill was run (`backup-drill.log`) |
| P1 | Penetration test on staging (after S-B2 … S-B7) | BLOCKED_EXTERNAL | Kevin | no independent assessment exists |
| P1 | `DB_TENANT_RLS=1` and `DB_TENANT_RLS_STRICT=1` in production | OWNER_ACTION (config) | Kevin's developer | without them the database layer does not isolate salons (the app layer still does); tested: strict mode returns 0 rows without a tenant |
| P2 | Tap to Pay: Apple entitlement, CommerceHub SDK + sandbox (VERIFY markers in `commercehub.client.ts`, refund / cancel field names), per-location merchant onboarding, real iPhones | BLOCKED_EXTERNAL | Kevin + Apple + Fiserv | feature stays off until UAT |
| P2 | Twilio A2P brand / campaign + numbers, SendGrid domain, Firebase / APNs (new keys), OCR bucket + ClamAV + Textract, AI / voice keys | BLOCKED_EXTERNAL | Kevin | features degrade honestly today ("not configured") |
| P2 | Native mobile builds / store signing on a Mac; Play upload-key replacement | BLOCKED_EXTERNAL | Kevin | no device or signing in this environment |
| P2 | 27-inch touchscreen, EN + VI, on this commit | NOT_TESTED (no browser build without vite / React) | developer | last run Oct 27 (`docs/pilot-runs/2026-10-27-vietnamese-open/`, 54 / 54 primary viewport) — before POS-only Vietnamese (`05ac57cd`) |

Nothing in this run found a double-charge path, a tenant leak or a ledger-loss defect; the absence of a finding is not the
same as the provider and device validation above, which only Kevin's accounts and hardware can give.

## Critical path to PRODUCTION_READY = YES (in order)

1. **V-28 (developer, internal):** `npm ci` → `npm run typecheck` → `npm run ci:gates` → `ci:test:{packages,modules,apps,api}`
   → race lane → `live-pilot-day.mjs` on a fresh database through migration 706 (see `TEST_RESULTS.md` §7 for the exact
   commands). Fix what they name. This is the gate that turns the Oct 28 work from BUILT into DONE.
2. **K-12 (Kevin's developer):** the seven steps above, in order; only then `git push … merge-github-main:main`.
3. **P0-2:** a salon's MID in Super Admin → `cd apps/api && npm run uat:cardpointe` ($1 sale → void, refund inquiry).
4. **Hosting:** RLS flags, DB roles, private 5432, WAF, `_headers`; a restore + PITR drill on the real backups (the same
   steps as `tooling/full-system-test/backup-drill.sh`, run by the owner on an isolated instance).
5. **Penetration test**, then the provider UATs (Tap to Pay, Twilio, SendGrid, push, OCR) as each account arrives.
