# Customer Retention — Round 2 (Four-Module Completion Guide, CR-01..CR-04) — Oct 30 2026

Source: *AI PowerSalon — Complete the Four Unfinished POS Modules* (Oct 30 2026), §1–5, §15–19, items CR-01..CR-04.
Builds on `docs/handoff/CUSTOMER_RETENTION_GUIDE_2026-10-30.md` (route `/tenant/customers/retention`, `/pos/retention/*`).
I extended that code and did not rewrite it. Local commit only. Nothing was pushed or deployed, and migration 724 has not run on any database except the local test template. No SMS
was sent (the harness messenger only records texts), and no provider or billing system was called.

## 1. Status matrix (vocabulary from the guide §1)

| ID | Deliverable | Status | Evidence / blocker |
|---|---|---|---|
| CR-01 | Versioned historical snapshots + backfill | **Verified** (schema, job, backfill, reads, UI) · nightly *scheduling in production* **Blocked - External Setup** | pgtest `retention-round2` CR-01 (8 tests) + harness E2E steps 24–25. The scheduler is env-gated and off by default. Turning it on in staging needs the owner to set `RETENTION_SNAPSHOTS_CRON_ENABLED=1` on a process that runs `standard` jobs. |
| CR-02 | Branch activity filter | **Verified** | pgtest CR-02 (3 tests) + E2E step 23 (one customer, 9 visits salon-wide, 2 at Voorhees, one row each; other-salon and unknown branch → 403) |
| CR-03 | SMS cost estimate | **Verified** | pgtest CR-03 (3 tests) + E2E step 26 ("Price unknown — cannot estimate" → price set in Settings → "at least $0.07"; audited) |
| CR-04 | Booking customer prefill | **Verified** in the harness. The real booking module on staging is **Implemented but Unverified**. | E2E step 27: row and overlay both open `/booking/new?customerId=…&from=retention`; the customer is loaded from the server; 0 writes; appointment count unchanged; an unknown id gives an actionable error. Screen tests are written (they cannot run here). |
| — | pos-web vitest (screen tests) | **Implemented but Unverified** | pos-web vitest cannot run in this environment. Run in CI: `cd apps/pos-web && npx vitest run src/screens/POSRetentionScreen.test.tsx src/screens/POSNewBookingScreen.test.tsx` |
| — | Staging / CI / physical ASUS screen | **Blocked - External Setup** | no push, no staging, no device access (guide QA-01..04) |

## 2. Audit — what existed and what I chose

* **Snapshots:** nothing stored. The live screen always computes "as of today". There was no history of the salon's threshold
  versions (only the current `tenant_retention_settings` row plus audit rows).
* **Branch access:** the session carries `req.ctx.authz.{scope, branchIds}` (the role template's scope; the same rule payroll uses
  in `payroll-workflow.service.ts readScope`). A session confined to `BRANCH` / `SELECTED_BRANCHES` gets its `branchIds`, or its
  session branch if it has none. Every other session gets every active branch of the salon. `tickets.branch_id` is `NOT NULL` with **no FK**,
  so "Unknown branch" means a ticket whose `branch_id` is not one of this salon's branches (null is handled the same way, defensively).
* **SMS pricing:** `sms_verification_packages` holds the monthly plans and the OTP overage. `platform_settings`
  `sms.marketing_segment_price_cents` = 3.5 is one platform-wide number, with no currency, carrier fee, tax, effective date or tenant. Neither of these is
  a tenant price, so I added `tenant_sms_pricing`. The platform number is **not** used as a confirmed price.
* **Booking:** the canonical New Appointment flow is `/booking/new` (`POSNewBookingScreen`). It already accepted
  `?customerId=&customerName=&customerPhone=` from Checkout's "Rebook Guest", but it trusted the name and phone in the URL and never
  loaded the record. The old retention button went to `/booking?customerId=`, which ignores the parameter.
* **Fixed along the way:** the controller's SMS preview dropped every `selection` filter except segment and search, so preset, basis,
  band, sms, visits and (now) branch were never passed on. It now passes the full filter set.

## 3. What was built

### CR-01 historical snapshots
* `modules/customers/src/retention/retention-snapshots.ts` (`RetentionSnapshotRepository`, `runRetentionSnapshotJob`):
  * The `retention.snapshot.day` durable job (class `standard`, `maxAttempts 5`, the queue's exponential backoff and dead-letter) computes
    **one completed salon-local day for one salon**. The run row is claimed under an advisory lock, and all rows for the day are written in **one** transaction
    (insert-only, `on conflict do nothing`). A completed run is returned unchanged (idempotent: `skipped`). A failure sets
    `status='failed'` + `last_error` on the run (visible on screen) and rethrows so the queue retries.
  * **definition_version** = `retention-v2+s<settings version in force at the end of that day>`, read from the new
    `tenant_retention_settings_history`. `updateSettings` now appends a history row in the same transaction as the change and its audit.
    A later threshold change therefore creates a **new** version and never rewrites a stored day (pgtest).
  * As-of rules (end of the salon day, `America/New_York` or the salon's zone):
    * Customer: profile created before the end of the day and not archived by then.
    * Visit: closed or paid, `coalesce(paid_at, created_at)` before the end of the day, not removed by then. One ticket = one visit.
    * Value: net of refunds recorded by then.
  * Coverage:
    * `complete`: the nightly job computed yesterday.
    * `reconstructed`: the backfill, or a late nightly run.
    * `incomplete` (no rows written): the date is before the salon's first ticket, the salon has no ticket history, or the thresholds in force on that date are unknown.
  * The backfill (`requestBackfill`) is limited to completed days only and at most 366 days. It queues one job per day, staggered 2 s apart, with idempotency key
    `retention-snapshot:<tenant>:<date>:<requestId>`. The audit `retention.snapshot.backfill.requested` runs **in the same
    transaction**, so if the audit fails nothing is queued (pgtest).
  * Reads (no recompute in any GET): `day`, `members` (paged drill-down, masked phones), `compare` (deltas and who moved between
    segments), `runs`.
* `retention-snapshot.scheduler.ts` (`RetentionSnapshotWorker`, registered in `customers.module.ts`) always registers the
  job handler. The nightly scheduler runs only when `RETENTION_SNAPSHOTS_CRON_ENABLED` is set and `runsBackgroundJob('standard')` is true. It checks hourly
  under `runAsSingleOwner` + `runTick`. For each active salon past 1 AM local time it enqueues yesterday once (key `…:<date>:nightly`), staggered across 30 minutes
  by a tenant hash.
* UI: an **As of Date** header button opens `HistoryDialog`:
  * a date picker (defaults to yesterday) and a "Compare with" date;
  * a state banner with `data-state`: available / missing / incomplete / running / failed / not_completed. Anything other than available reads
    **"Incomplete / unverifiable — …"**;
  * five count tiles that drill down to members;
  * the compare table with deltas and "Who moved between groups";
  * recent runs;
  * **Rebuild history** (only for `settings.edit`).

### CR-02 branch activity
* `RetentionRepository.branchScope(ctx, requested)` + `Win.scope`. In branch mode, visits, refunds, recovery and the trend use
  `t.branch_id = any(branchIds)` only. Customers stay tenant-wide, with the same canonical id.
* `summary.scope` = mode, label (`tenant_wide` / `branch_activity`), authorized branches and `unknownBranchVisits`.
* `?branch=` is accepted on summary, customers, export, recovery and the SMS selection. A branch outside the session's authorized set →
  **403 `BRANCH_NOT_AUTHORIZED`**, and a non-uuid → 400. For a branch-confined user, "All authorized branches" means the union of their own branches, never the
  other branches' activity.
* UI: the panel title shows a scope chip, "Tenant-wide customer retention" or "Branch activity retention · <name>", plus "Unknown branch: n".
  The branch select ("All authorized branches" / each branch) sits in the list panel's actions.
* Historical snapshots are **tenant-wide only**. The dialog says so. Per-branch snapshots are **Not Built**.

### CR-03 SMS cost estimate
* `retention-pricing.ts`: `estimateSms` is pure. It uses exact decimals (micro-units) and counts **eligible recipients only**, so opted-out
  customers, duplicate phones, missing consent and the like are already excluded × segments per message (GSM-7 / UCS-2 from `smsSegments`) × the unit price. Carrier fee and
  tax are included only when known; otherwise the total is shown as "at least …" with the uncertainty text. With no price in force the
  result is `price_unknown` and `costEstimateCents: null`, shown as **"Price unknown — cannot estimate"**, never $0.
* `RetentionPricingRepository`: `pricingAt` (the latest `effective_from ≤ now`; a future price is listed as "Scheduled"),
  `setPricing` (append-only insert, validated, with audit `retention.sms_pricing.set` before/after in the same transaction).
* Who sets the price: `pos.settings.edit`, the same key as the retention thresholds. A Super Admin route is **Not Built**. The owner should decide
  whether this belongs to Super Admin only.
* UI: an `EstimateBlock` in the SMS preview, and a "SMS price for estimates" section in Retention Settings (`marketing.view` to see it,
  `settings.edit` to save).

### CR-04 Booking prefill
* Retention's row action 📅 and the customer overlay's **Book appointment** both go to `/booking/new?customerId=<id>&from=retention`. Only the id is in the URL; no
  name or phone.
* `POSNewBookingScreen`: any `?customerId=` is now **loaded** with `posCustomersApi.getDetail` (GET `/pos/customers/:id`, this
  salon's record only) before it shows as chosen. Checkout's name in the URL is still shown, but only until the server answers.
  * If the customer is deleted, archived, from another salon or the load fails, the screen shows "This customer could not be loaded … Search for the customer below." and
    the manual search, with nothing preselected.
  * Opening the screen writes nothing. Only the existing Confirm Booking submit creates an appointment, with the existing validation and rules.

## 4. API (all `TenantAuthGuard + RolePermissionGuard`; the tenant comes from the session)

| Route | Permission | Notes |
|---|---|---|
| `GET /pos/retention/snapshots/day?date` | pos.customers.view | state, run (coverage, definition, thresholds, watermark, error), counts (allowlisted: not-a-list) |
| `GET /pos/retention/snapshots/members?date&segment&q&page&pageSize` | pos.customers.view | ListQuery |
| `GET /pos/retention/snapshots/compare?a&b` | pos.customers.view | allowlisted: fixed-size |
| `GET /pos/retention/snapshots/runs?from&to&page&pageSize` | pos.customers.view | ListQuery, dateRange ≤ 400 |
| `POST /pos/retention/snapshots/backfill {from,to}` | **pos.settings.edit** | `RETENTION_SNAPSHOT_BACKFILL_BODY`; 400 `SNAPSHOT_INVALID_RANGE` |
| `GET /pos/retention/sms/pricing` | pos.marketing.view | current, upcoming, history, canEdit |
| `PUT /pos/retention/sms/pricing` | **pos.settings.edit** | `RETENTION_SMS_PRICING_BODY`; 400 `SMS_PRICING_INVALID` |
| `?branch=` on summary / customers / customers/export / recovery; `selection.branch` on sms/preview | as before | 403 `BRANCH_NOT_AUTHORIZED`, 400 `RETENTION_INVALID_BRANCH` |
| `POST /pos/retention/sms/preview` response | | + `estimate`; `costEstimateCents` = estimate total or null |

I regenerated the OpenAPI manifest and the attack surface (7 new routes).

## 5. Migration 724 (`apps/api/db/migrations/724_retention_snapshots_sms_pricing.sql`) + recovery

* The migration is **expand-only and idempotent**. It adds:
  * `tenant_retention_settings_history`: append-only, seeded once from the current settings rows;
  * `customer_retention_snapshot_runs`;
  * `customer_retention_daily_snapshots`: append-only, unique `(tenant_id, customer_id, snapshot_local_date, definition_version)`, indexed by tenant/date/version/segment
    and tenant/customer/date;
  * `tenant_sms_pricing`: append-only, effective-dated.
  
  A trigger raises an exception on UPDATE or DELETE of each append-only table (pgtest proves it on the snapshots and pricing tables).
* Applied to the test template `aps` **twice**, both times exit 0; the second run only printed "already exists, skipping" notices:
  `psql -h /tmp -p 55432 -U postgres aps -v ON_ERROR_STOP=1 -q -f apps/api/db/migrations/724_retention_snapshots_sms_pricing.sql`.
  Postgres was restarted by the coordinator around 13:10–13:17. After the restart I checked that all 4 tables exist in `aps`.
* **Rollback:** revert the code. The tables are then simply unread. Do **not** drop them: they hold the salon's history and its configured
  price. A staging or production run needs owner approval. The tables are new, so building the indexes takes no meaningful lock.
* **Gap (documented):** settings versions changed *before* this migration were never stored. If a salon's seeded row is at version > 1,
  dates before that row's `updated_at` come out as `incomplete / definition_unknown` rather than guessed.

## 6. Tests actually run (this machine, Oct 30 2026)

* `FST_PG_TEMPLATE=aps REPO_ROOT=$PWD bash tooling/full-system-test/unit-standin/run.sh $PWD modules/customers/src/retention/retention-round2.pgtest.vitest.spec.ts`
  → **14 passed, 0 failed**. The tests cover:
  * one customer Active on day −90 and At Risk on day −20;
  * never-visited and cancellation-only customers;
  * the time-zone boundary (11:30 PM local counts for that day, 12:30 AM the next day does not);
  * an idempotent rerun, and the append-only trigger;
  * a config change creating a new version (and a stored day not rewritten);
  * a missing date → unverifiable, a date before the first ticket → incomplete, and today refused;
  * day / members / compare / runs reads, with other-salon isolation;
  * backfill bounds and audit fail-closed, job run plus retry no-op, nightly `complete`, nightly enqueue idempotent;
  * the A/B branch customer, unknown-branch tickets, unauthorized and invalid branches, the confined user's union;
  * the SMS estimate: no price, GSM vs UCS-2, opted-out and duplicate phone excluded, append-only pricing, arithmetic with fees and tax, a future price not yet in force.
* The same runner: `retention-guide.pgtest` → **12 passed, 0 failed**; `retention.pgtest` → **10 passed, 0 failed** (no regression).
* `FST_PG_TEMPLATE=aps node tooling/customers-one-screen/interact.mjs cr2-e2e` → **48/48 passed, 0 page errors**. That is the 42
  earlier steps plus 6 new ones: CR-02, CR-01 ×2, CR-03, CR-04, and the VI scope line. Evidence is in `tooling/customers-one-screen/results/cr2-e2e/`.
* `FST_PG_TEMPLATE=aps node tooling/customers-one-screen/measure.mjs cr2-measure retention` → **12/12 PASS** (1920×945, 1536×729,
  1440×765, 1366×633 · pilot EN / pilot VI / empty EN). No page scroll, no hidden module (including the new `open-history` and `flt-branch`), no target
  under 44 px, unhandled routes []. Rows per page are 9 / 5 / 6 / 3 (EN), compared with 10 / 6 / 7 / 4 in the earlier `final` run.
* I syntax-checked the screen, the booking screen and both screen tests with esbuild, and ran the `tsc` undefined-name check (TS2304/TS2552) on the changed files: clean.
* Gates:
  * pass: list-queries (0 failures, 2 new allowlist entries), tenant-isolation (no new unscoped queries), as-any (no file above baseline),
    role-checks, validated-bodies, async-exports, select-columns, impossible-predicate, unreached-routes, silent-catch, audit-writers,
    vi-glossary, inert-controls, dead-client-methods;
  * no new domain events, so the event-producers check is not needed.
  
  `check-pos-i18n` fails only on `apps/pos-web/src/screens/POSAiUsageScreen.tsx` (2 raw `.type` codes). That file is
  untouched by this change (it came in with the AI Usage commit 9c02b2ab; I did not re-run the gate at the base commit). The new retention / booking files add nothing to the ratchet.
* Harness note: the new-appointment screen's catalog, technicians, availability and drafts are **read-only stand-ins** in
  `live-server.mjs`, because the booking module is not mounted in the customers harness. The E2E proves the prefill and that nothing is written. The booking
  submit itself is not exercised here.

## 7. Files

Backend — `modules/customers/src/retention/{retention-snapshots.ts, retention-snapshot.scheduler.ts, retention-pricing.ts}` (new),
`retention.repository.ts` (branch scope, settings history), `retention.controller.ts` (7 routes, `?branch=`, full preview selection),
`retention-sms.service.ts` (estimate), `modules/customers/src/request-schemas.ts`, `modules/customers/src/customers/customers.module.ts`,
`apps/api/db/migrations/724_retention_snapshots_sms_pricing.sql`, `apps/api/scripts/list-queries.allowlist.json`.
Frontend — `apps/pos-web/src/screens/POSRetentionScreen.tsx`, `POSNewBookingScreen.tsx`, `api/posRetentionApi.ts`,
`i18n/ns/retention3.{en,vi}.ts` (88 keys) + `i18n/ns/index.ts`, `styles.css` (`rt3` block).
Tests — `retention-round2.pgtest.vitest.spec.ts` (new), `POSRetentionScreen.test.tsx` (+4), `POSNewBookingScreen.test.tsx` (+2).
Harness — `tooling/customers-one-screen/{seed,live-server,interact,measure}.mjs`. The seed adds a second Pilot branch "Voorhees" and 2
unknown-branch tickets.
Docs — this file, `docs/i18n/VI_NEW_STRINGS_FOR_REVIEW.md` §A50, the regenerated `apps/api/openapi/manifest.txt` and `docs/security/*attack-surface*`.

## 8. Residual risks / owner actions

1. Approve migration 724 for staging, then production. Set `RETENTION_SNAPSHOTS_CRON_ENABLED=1` on one worker in staging, and look at
   `customer_retention_snapshot_runs` the next morning.
2. Run the pos-web screen tests in CI (command in §1).
3. Decide whether the SMS price should be set by Super Admin only. It currently needs `pos.settings.edit`. Then enter the real per-segment price, carrier
   fee and tax, so the estimate stops showing "at least".
4. Review the Vietnamese strings (§A50).
5. The snapshot cost is one set-based insert per salon-day, about `customers` rows each. I have not load-tested it at 100k customers × 366-day backfills.
   Recommend an `EXPLAIN ANALYZE` on the largest pilot salon, and a smaller backfill window for very large salons.
6. Per-branch historical snapshots and a Super Admin pricing UI are **Not Built**.
