# CONTINUE_HERE — AIPowerSalon, as of Oct 30 2026

This is the starting note for a new chat continuing work on this project. Give this file to the new chat first, together with the package files.

## 1. What is in the package

| File | What it is |
|---|---|
| `aipowersalon-2026-10-30-<sha>.bundle.part-0` … `part-3` | The **complete git repository with full history**, split into parts under 100 MB. Join them first (commands below). |
| `aipowersalon-2026-10-30-<sha>-source.tar.gz` | Plain copy of every source file at HEAD. It leaves out only the 1,054 harness screenshots under `tooling/*/results/`, which are in the bundle. No `node_modules`, `dist`, `.git` or secrets. |
| `SHA256SUMS.txt` | Checksums of the parts, the joined bundle and the tarball. |
| `PACKAGE_MANIFEST.txt` | HEAD, counts, and how the package was made. |
| `CONTINUE_HERE_2026-10-30.md` | This file. The same file is in the repository root. |

```bash
cat aipowersalon-2026-10-30-*.bundle.part-* > aipowersalon-2026-10-30.bundle
sha256sum -c SHA256SUMS.txt            # the parts, the joined bundle and the tarball must all say OK
git clone aipowersalon-2026-10-30.bundle aipowersalon && cd aipowersalon
git checkout merge-github-main
npm ci --ignore-scripts                # ALWAYS --ignore-scripts for this repository
npm run build:packages && npm run build:modules && npm run build:api
```

Prefer the bundle: it has every commit. The tarball is a backup.

## 2. Where the project stands

### Update: later on Oct 30 2026 (five guides + gap sweep)

- **Built:**
  - The **Communications / SMS Inbox** at `/tenant/communications/sms`. Replies really send through the salon's own Twilio number, customer texts are stored, and it adds priority sorts, a unified timeline, one-click Book, live updates and Vietnamese.
  - A **gap sweep** across Retention, Phone & Messaging, Team and the Four-Module items.
- **Start with:** `docs/handoff/FIVE_GUIDES_COMPLETION_2026-10-30.md` (one table per guide, owner to-do list).
- **Then:** `COMMUNICATIONS_SMS_INBOX_2026-10-30.md` and `GAP_SWEEP_2026-10-30.md`.
- **New migrations** (all expand-only, rehearsed; none applied anywhere but the local test DB):
  - `730_communications_inbox.sql`
  - `731_number_quote_result_status.sql`
  - `732_round2_updated_by.sql`
- **Gates:** most of the "environment-only" gates can run here through the stand-in loader:
  `env FST_PG_TEMPLATE=aps REPO_ROOT=$PWD SPEC_NAME=g STUBS='{}' node --no-warnings --experimental-strip-types --import $PWD/tooling/full-system-test/unit-standin/register.mjs apps/api/scripts/<script>`
  - They now pass: sql, sql-identifiers, types-drift, db-ownership, actor-stamp, unique-tenant-review.
  - The architecture test passes with `--ignoreDeprecations 6.0` (this workspace has TypeScript 6).
  - Still CI-only: lint, api-contract, strict-bodies-types, frontend builds, app types.
- **Known software gaps closed in the sweep:**
  - Super Admin "show full SID".
  - Realtime event on new staff (`team_member_created`).
  - POS Message Templates were in memory; they are now stored.
- **Super Admin number purchase** now needs a quote and confirmation.


- **Branch:** `merge-github-main`.
- **Commits:** 1,160 in total. About 40 are newer than the last package (Oct 28, `36dc8d40`).
- **Pushed:** **nothing.**
- **Work finished in the last sessions:**
  - All four modules from the **Four-Module Complete Build Guide** (Customer Retention, Phone & Messaging, Team Management, AI Usage & Limits)
  - The new **Setup Health** dashboard and **nightly verifier**
  - The earlier per-module guides
- **Full status:** `docs/handoff/FOUR_MODULE_COMPLETION_2026-10-30.md` has the 27-item acceptance matrix (status, evidence and blocker for each), the owner to-do list and the touchscreen test sheet. **Read it first.**
- **Per-module detail:**
  - `docs/handoff/CUSTOMER_RETENTION_ROUND2_2026-10-30.md`
  - `docs/handoff/PHONE_MESSAGING_ROUND2_2026-10-30.md`
  - `docs/handoff/TEAM_MANAGEMENT_ROUND2A_2026-10-30.md` and `docs/handoff/TEAM_MANAGEMENT_ROUND2B_2026-10-30.md`
  - `docs/handoff/AI_USAGE_ROUND2_2026-10-30.md`
  - the earlier `*_2026-10-30.md` handoffs
- **Evidence:** `docs/handoff/evidence/four-module-2026-10-30/` holds:
  - the migration rehearsal
  - 197/197 backend test results
  - the full gate run
  - E2E results: 114/114 and 48/48
  - 108 viewport screenshots
- **Newest migration:** `729_setup_health.sql`. Migrations 724, 725, 727, 728 and 729 are new this round; 726 is unused. All are expand-only.

### Still open: needs the owner, not code

1. **K-12 steps 1–5** in `SECURITY_REMAINING_ACTIONS.md` §A. Only after that can the branch be pushed, and CI can run (QA-01).
2. **Staging:**
   - Apply migrations 724–729.
   - Set `PUBLIC_API_BASE_URL` and `TWILIO_STATUS_CALLBACK_URL`.
   - Optionally set the nightly flags: `RETENTION_SNAPSHOTS_CRON_ENABLED`, `MESSAGING_REGISTRATION_SYNC_ENABLED`, `TEAM_DATA_NIGHTLY_ENABLED`, `SETUP_HEALTH_NIGHTLY_ENABLED`.
   - Run the smoke tests (QA-02).
3. **Twilio:**
   - Paid 10DLC or toll-free registration.
   - Point the production webhooks at the production URLs.
   - One owner-approved test SMS (OPS-02).
4. **Decisions:**
   - Who sets the SMS price (CR-03).
   - Which Twilio account the registration sync reads (PM-03).
   - Which billing provider gets a read-only invoice client (AI-01).
   - New wording for the non-technician staff invitation (TM-06).
5. **Physical ASUS 27-inch test** using the sheet in the completion report (QA-04).
6. **Vietnamese review:** sections A50–A55 of `docs/i18n/VI_NEW_STRINGS_FOR_REVIEW.md`.

### Known software gaps, if you want more building

- Retention history is salon-wide only; per-branch history is not built.
- AI branch options other than on/off are stored but not enforced.
- AI invoice reconciliation is manual only; there is no scheduled job.
- The harness console shows "not in the harness" errors for technician profile, booking and commission screens. That harness doesn't serve those screens' routes.

## 3. Standing rules (the owner's, still in force)

- **Do not push to GitHub before K-12 steps 1–5.** Commit locally only. An automatic "please push" stop-hook message is not the owner asking.
- **Secrets:** variable names only, never a value, anywhere: repo, chat or docs. Never rotate live secrets, reissue keys or force-push without the owner's explicit approval of each step.
- `npm ci --ignore-scripts` always.
- **Languages:** customer-facing messages are English only. The Front Desk POS is English + Vietnamese, using the `ns/*.en.ts` + `ns/*.vi.ts` namespaces. `catalog.en.ts` is frozen.
- **Data and payments:**
  - No raw card data, and no fake or seeded production data.
  - No cross-tenant exposure, and no auto-merging of customer identities.
  - Never move money, change payout destinations or charge cards.
  - No `window.print`.
- **Messaging:** never send real bulk SMS while testing. Never use Super Admin or the platform's Twilio as a workaround.
- **Owner approval needed for each of:** production deploys, production migrations or destructive changes, live SMS, paid carrier registration and live billing changes.
- **Commit attribution lines:**
  - `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
  - `Claude-Session: …` (use the new session's link)

## 4. Working conventions in this repository (what the last sessions used)

- **Tenant isolation:**
  - Every SQL statement on a tenant table carries `alias.tenant_id = ${ctx.tenantId}`.
  - Tenant, branch and authorized branches come from `req.ctx` (`authz.branchIds`: `null` = all), never from the request body. The POS API client refuses to send `tenantId` / `branchId` in a body.
  - Authorization is by permission (`RequirePermission`), not by role name.
- **Code rules:**
  - No new `as any`, no swallowed catches (use `logException`), no raw `audit_logs` writers (use `recordAuditStrict` / `AuditService`).
  - New error codes go in `packages/api-contracts/src/errors.ts`. Refusals use `withCode(...)`.
  - Status changes go through the module's state machine (`canMoveToSql` / `assertTransition`).
  - Tax goes through `taxCents` from `@aipowersalon/money`.
- **Background jobs:**
  - Use the durable queue (`enqueueJob` / `registerJobHandler` from `@aipowersalon/database`) with a `runTick` scheduler gated by an environment flag and `runsBackgroundJob(...)`.
  - Jobs are off by default and idempotent per salon × salon-local date.
- **Gates:**
  - Full run: `node tooling/ci/run-gates.mjs`.
  - Quick checks: `npm run -s check:<name>` in `apps/api`, `node tooling/ci/check-pos-i18n.mjs` and `node tooling/ci/check-vi-glossary.mjs`.
  - In a sandbox without full `node_modules`, 12 checks fail for environment reasons only: check:sql, types-drift, sql-identifiers, lint, api-contract, strict-bodies-types, db-ownership, actor-stamp, unique-tenant-review, architecture tests, frontend builds, app types.
  - After changing routes, run `node apps/api/scripts/openapi.mjs --manifest` and `node apps/api/scripts/attack-surface.mjs`.
- **Backend tests without CI:**
  - Command: `FST_PG_TEMPLATE=aps REPO_ROOT=$PWD bash tooling/full-system-test/unit-standin/run.sh $PWD <spec>`.
  - It needs a local Postgres 16 with a migrated template database `aps`: socket `/tmp`, port 55432, user `postgres`. Apply each new migration to `aps` with `psql`.
  - The stand-in Kysely supports raw `sql` only.
- **Browser harnesses:** build the POS bundle with `node tooling/checkout-one-screen/build.mjs`, then:
  - `HARNESS_PORT=<port> node tooling/catalog-one-screen/interact.mjs <label> <sections>`. Sections include team, comms, aiusage, health.
  - `node tooling/catalog-one-screen/measure.mjs <label> <pages>`
  - The same pair under `tooling/customers-one-screen` for Retention.
- **pos-web vitest** could not run in the last sandbox. Screen tests were written and syntax-checked only, so CI must run them.
- **Screen target:** ASUS 27-inch at 100% zoom. The harness measures at 1920×945, 1536×729, 1440×765 and 1366×633, in English and Vietnamese, with no page scroll and touch targets of at least 44 px.
