# Four-Module Completion Report: Customer Retention · Phone & Messaging · Team Management · AI Usage & Limits + Setup Health

Build guide: *AI PowerSalon — Four Modules Complete Claude Build Guide* (18 pages, Oct 30 2026)
Branch: `merge-github-main`, local only. **Nothing was pushed.** Pushing is still blocked by SECURITY_REMAINING_ACTIONS.md §A (K-12 steps 1–5).
HEAD at the time of writing: `5f42bca0`. Evidence folder: `docs/handoff/evidence/four-module-2026-10-30/`.

## How to read the statuses

- **Verified** means proven here, on this branch. The proof is real tests against a real Postgres 16 copy of the schema, plus a real browser driving the real POS bundle against the real controllers and SQL. It is **not** CI and **not** staging.
- **Implemented but Unverified** means the code exists but no check here exercised it end to end.
- **Blocked - External Setup** means it needs an account, environment, device or owner approval that this session does not have.
- **Not Built** means it does not exist yet.

The guide says an unverified feature cannot be marked finished. So **nothing here is release-ready until QA-01 (CI), QA-02 (staging) and QA-04 (the physical ASUS touchscreen) are done.** All three are Blocked - External Setup. The exact steps are in §6.

## 1. Final acceptance matrix

| ID | Deliverable | Status | Evidence here | Blocker / what is still outstanding |
|---|---|---|---|---|
| CR-01 | Versioned retention snapshots + backfill | **Verified** | `retention-round2.pgtest` 14/14: two-date test, versioned thresholds, incomplete backfill marked, idempotent job. E2E "As of Date" steps. Migration 724. | Turning the nightly job on in staging (`RETENTION_SNAPSHOTS_CRON_ENABLED=1`) is Blocked - External Setup. Per-branch history: **Not Built** (snapshots are salon-wide). |
| CR-02 | Branch activity retention filter | **Verified** | Cross-branch pgtest: no identity duplication, unauthorized branch returns 403 `BRANCH_NOT_AUTHORIZED`, "Unknown branch" counted, never allocated. E2E step. | — |
| CR-03 | SMS cost estimate | **Verified** | pgtest: no price gives "Price unknown — cannot estimate" (never $0); GSM-7 vs UCS-2; opted-out and duplicate phones excluded; sending still needs authorization. New `tenant_sms_pricing` (effective-dated, audited). | Owner decision: should only Super Admin set the SMS price? Today Retention Settings sets it with `pos.settings.edit`. |
| CR-04 | Booking customer prefill | **Verified** in the harness; **Implemented but Unverified** against the live Booking module | E2E: Book Appointment opens `/booking/new?customerId=…&from=retention`, the customer is preselected, 0 writes until Confirm. | The harness stands in for the booking engine's reads; the real submit was not exercised. |
| PM-01 | Branch-specific test SMS | **Verified** (fake Twilio) | `phone-messaging-round2.pgtest` 28/28: salon default vs branch override pick the right sender and account; another branch returns 403, another salon 404. | A real send is Blocked - External Setup (owner-approved single test send, OPS-02). |
| PM-02 | Consistent SID masking | **Verified** | The pgtest scans 30+ responses and all audit rows: no full SID, token or ciphertext anywhere. The full SID needs a step-up and is audited. | Super Admin has no "show full SID" button (by choice). |
| PM-03 | Twilio 10DLC status sync | **Verified** against fixtures | Append-only provider snapshots (migration 725). "Approved" needs a Twilio confirmation under 72 h old. A provider outage shows Unknown with the last good check. | Real Twilio field names have only been tested against the fake. **Owner decision:** if the brand was registered under the platform's Twilio account, which account should the sync read? |
| PM-04 | Toll-free verification tracking | **Verified** against fixtures | Sender-type tests, state mapping, unapproved toll-free blocks texting, nothing is submitted from the app. | Real toll-free submission is a paid, owner-only step. |
| TM-01 | Customer-linked staff search | **Verified** | `team-members-lookup.pgtest` 6/6: multi-tech ticket, tenant B inaccessible both ways, masked phone. E2E: search by phone in 3 formats and by name. | Archived staff who served the customer are not listed. |
| TM-02 | Page sizes + URL state | **Verified** | E2E: 10/20/50, refresh, Back/Forward, page clamp; search text never in the URL. Pure spec 6/6. | — |
| TM-03 | New staff → page 1 | **Verified** | E2E: create returns with filters kept, page 1, newest first, highlighted; filters that hide the person offer View / Clear; a retried create makes 1 row (Idempotency-Key). | — |
| TM-04 | Preferred technician search | **Verified** (engine responses stubbed) | pgtest: each conflict named, qualified alternatives returned, nothing booked. E2E step. | The real booking-engine cross-check is unverified in the harness. |
| TM-05 | Real-time Team Management | **Verified** in the harness | E2E: live event refreshes in place; stale event or response ignored; stream down → Polling (30 s) → reconnect; "Live" only while connected. | Creating a staff member emits no realtime event yet, so other screens catch it by polling. |
| TM-06 | Non-technician staff creation | **Verified** | `team-staff.pgtest` 18/18: receptionist/manager permissions; no role at or above the actor's; no technician record, PIN or commission for a receptionist; duplicate contact returns 409. E2E creates a receptionist → page 1. | The invitation text still says "join as a technician". It must be reworded before real e-mail/SMS delivery is turned on. |
| TM-07 | Scheduled accuracy checks | **Verified** (job handler, dedupe, failure escalation) | pgtest + E2E: deduplicated findings, last seen / seen count, reviewer decisions never overwritten, nothing in payroll changed. | The hourly scheduler inside a real worker process is Implemented but Unverified; staging is Blocked - External Setup. |
| TM-08 | Optional birthdays | **Verified** | pgtest + E2E: month/day only, private by default, Feb 29 handled. | — |
| TM-09 | Training & certification | **Verified** | pgtest: lifecycle, expiry, holder cannot self-verify, completion ≠ verified certification. | — |
| AI-01 | Invoice / tax / proration reconciliation | **Verified** with fixtures | `ai-invoices-branches.pgtest` 14/14, including the guide's case ($59 − $10 proration + $3 tax, $0 paid → $52 due), duplicate / out-of-order webhooks and refunds. Missing tax shows Pending/Unknown, never $0. | Real reconciliation is **Blocked - External Setup**: no read-only billing-provider client is connected, so a run is recorded as failed (`provider_not_configured`). Setup Health shows this as "Waiting on outside setup". |
| AI-02 | Per-branch AI settings | **Verified** | pgtest: Branch A on / B off on one subscription with a shared quota; global disable beats a branch enable; an expired trial can't be bypassed. | Branch options beyond on/off are stored and audited but no feature reads them yet. |
| HL-01 | Unified Setup Health dashboard | **Verified** | `setup-health.pgtest` 8/8: Ready only from verified fresh evidence, stale → Unknown with last good time, 72 h registration rule. E2E 5/5, measure 12/12. | — |
| HL-02 | Nightly verification + alerts | **Verified** (queue job, idempotency, dedupe, escalation) | pgtest: 03:00 salon-time enqueue once per salon per date, a failed night retries, two failed nights raise one critical alert, alerts deduped and escalated once. Sidebar badge. | Off by default. `SETUP_HEALTH_NIGHTLY_ENABLED=1` in staging is Blocked - External Setup. |
| QA-01 | CI runs | **Blocked - External Setup** | Local substitute: full `run-gates.mjs` (every gate passes except 12 environment-only ones; reasons in §5) and 197/197 backend tests. | CI runs on GitHub, and pushing is blocked until K-12 steps 1–5. **No CI run ID exists.** |
| QA-02 | Staging migrations + smoke tests | **Blocked - External Setup** | Local rehearsal: each migration applied in a rolled-back transaction, then re-applied twice cleanly (`migration-rehearsal.txt`). | Needs staging access and your approval. |
| QA-03 | 27-inch responsive / browser testing | **Verified** (Chromium at 100% zoom) | 72 viewport checks pass across the four modules + Setup Health at 1920×945, 1536×729, 1440×765 and 1366×633, EN + VI: no page scroll or sideways scroll, touch targets ≥ 44 px. 108 screenshots in `evidence/…/screens/`. | Real Edge/Chrome on the device is part of QA-04. |
| QA-04 | Physical touchscreen validation | **Blocked - External Setup** (explicitly pending, **not passed**) | Manual test sheet in §7. | Needs you at the ASUS 27-inch. |
| OPS-01 | Twilio inbound / callback configuration | **Verified** (signed-callback tests with fakes) | Callback URLs checked for https, public host and route; every number's inbound webhook checked; replay and STOP opt-out tests. | The real webhook URLs must be set on the live Twilio numbers (owner). |
| OPS-02 | Registration + owner test-send checklist | **Blocked - External Setup** | Checklist: `PHONE_MESSAGING_ROUND2_2026-10-30.md` (OPS-02 section). | Paid carrier registration and one owner-approved live test send. |

## 2. Architectural audit

Everything was built on the existing modules. Nothing was rewritten.
- **Customer Retention:** extended `modules/customers/src/retention` (repository, controller, SMS service) and reused the durable job queue for snapshots.
- **Phone & Messaging:** extended `modules/communications/src/tenant-messaging`. The registration sync is a new read-only client next to the existing Twilio binding. SID masking happens at the existing credential read path.
- **Team Management:** extended `modules/workforce/src/team-screens` and added `team-staff/` for onboarding, birthdays and training. Technician hiring still uses the existing `POST /pos/technicians`, and certifications link to the existing `technician_certifications` table.
- **AI Usage & Limits:** extended `modules/super-admin/src/tenant-ai` and `modules/ai`.
  - The software-plan invoice tables were deliberately **not** reused, which avoids double counting.
  - AI cancel now goes through the shared `tenant_ai_subscription` state machine.
- **Setup Health (new):** `modules/super-admin/src/setup-health`. It reads each module's authoritative record and never calls a provider itself. It is wired through `TenantAiModule`, so `app.module` is untouched.
- **Shared infrastructure reused:**
  - job queue (`enqueueJob` / `registerJobHandler`), `runTick` schedulers (off by default)
  - `@Idempotent`, step-up, `recordAuditStrict`
  - the `useRealtime` stream, `packages/money` `taxCents`
  - the error registry, the POS i18n namespaces

## 3. Commits (local, on `merge-github-main`)

| Commit | What |
|---|---|
| `c8557800` | Setup Health dashboard + nightly verifier + release evidence (HL-01/02) |
| `9c1d0bff` → `c22985e5` | AI-01/AI-02, merged; Setup Health wired to migration 728 |
| `42df2dff` → `7ec71ddb` | CR-01..04, merged |
| `6dc961f6` → `ee152411` | PM-01..04 + OPS-01, merged; Setup Health reads the provider snapshots |
| `8123e650` → `bb8e72c0` | TM-06..09, merged |
| `55bddeaf`, `6c2653a8` → `3479835d`, `5103e72a` | TM-01..05, merged; Add Team Member returns through the TM-03 path |
| `5f42bca0` | Post-merge gate fixes + all evidence |

Per-module file inventories are in the round-2 handoffs:
- `CUSTOMER_RETENTION_ROUND2_2026-10-30.md`
- `PHONE_MESSAGING_ROUND2_2026-10-30.md`
- `TEAM_MANAGEMENT_ROUND2A_2026-10-30.md` and `TEAM_MANAGEMENT_ROUND2B_2026-10-30.md`
- `AI_USAGE_ROUND2_2026-10-30.md`

## 4. Migrations, API, jobs

**Migrations.** All are expand-only: new tables, nullable columns, a widened CHECK.

| Migration | Adds |
|---|---|
| 724 | Retention snapshot runs and daily snapshots, settings history, `tenant_sms_pricing` |
| 725 | Registration sync runs and snapshots (append-only), test-SMS columns |
| 727 | Team onboarding, birthdays, training, `team_data_nightly_runs`; widens `ck_team_data_alert_type` |
| 728 | AI invoice links, snapshots and events, reconciliation runs, branch settings + history, `ai_usage_logs.branch_id` |
| 729 | `health_check_runs`, `health_check_results`, `health_check_alerts`, `release_evidence` |

726 was not needed. Rehearsal results are in `evidence/…/migration-rehearsal.txt`.

**Rollback** means reverting the code. Do **not** drop the new tables: they hold salon history, configured prices and audit trails.

**API changes.** 37 new routes. They are listed in `apps/api/openapi/manifest.txt` and `docs/security/attack-surface-routes.csv`, both regenerated. New error codes are registered in `packages/api-contracts/src/errors.ts`.

**Background jobs.** Every job is off unless its environment flag is set. All are idempotent per salon × salon-local date, staggered, retried with backoff, dead-lettered, and recorded in a run table. None sends SMS or e-mail.

| Job | Flag | When |
|---|---|---|
| Retention snapshots | `RETENTION_SNAPSHOTS_CRON_ENABLED` | Nightly |
| Registration sync | `MESSAGING_REGISTRATION_SYNC_ENABLED` | Scheduled refresh |
| Team data check | `TEAM_DATA_NIGHTLY_ENABLED` | `TEAM_DATA_NIGHTLY_LOCAL_HOUR`, default 2 |
| Setup Health | `SETUP_HEALTH_NIGHTLY_ENABLED` | 03:00 salon time |

## 5. Tests and gates actually run here

- **Backend:** 197/197 across 16 suites (`evidence/…/backend-tests.txt`). After the final fixes, the two suites they touched were re-run: retention-round2 14/14, ai-usage-screen 8/8.
- **Browser E2E (real POS bundle):** catalog harness 114/114 and customers harness 48/48 (`evidence/…/e2e/`).
  - The catalog run logs one console error. It comes from routes of screens outside these modules (technician profile, booking, commission report) that the harness does not serve.
- **Viewport checks:** 72/72 (60 catalog + 12 retention).
- **Gates:** `node tooling/ci/run-gates.mjs` passes everything except 12 checks that cannot run in this sandbox because their npm dependencies are not installed here and the npm registry is unreachable: check:sql, types-drift, sql-identifiers, lint, api-contract, strict-bodies-types, db-ownership, actor-stamp, unique-tenant-review, architecture tests, frontend builds, app types. They must pass in CI (QA-01).
- **Not run:** the pos-web vitest screen tests (8 new or updated test files). They were written and checked for syntax and undefined names only; CI must run them.

## 6. What you need to do (owner approvals and external steps)

1. **Finish K-12 steps 1–5, then push** `merge-github-main` and open a PR. CI runs `npm ci && npm run build:packages && npm run build:modules && npm run security:fast && npm run architecture:test && npm run ci:gates` plus the test suites. Then record the run with `POST /super-admin/release-evidence` (`kind: ci_run`, with the run URL), so Setup Health turns "Automated tests (CI)" from waiting to Ready.
2. **Staging:**
   - Apply migrations 724–729 with `node apps/api/scripts/migrate.mjs`.
   - Set `PUBLIC_API_BASE_URL` and `TWILIO_STATUS_CALLBACK_URL` (https).
   - Optionally turn on the four nightly flags.
   - Run the smoke tests, then record a `staging_run`.
3. **Twilio, all paid or owner-only steps:**
   - A2P 10DLC brand and campaign registration, or toll-free verification.
   - Point every number's inbound and status webhooks at the production URLs.
   - One owner-approved live test SMS to your own phone.
4. **Decisions only you can make:**
   - Who sets the SMS price (CR-03).
   - Which Twilio account the registration sync reads when the brand was registered under the platform account (PM-03).
   - Which billing provider gets a read-only invoice client (AI-01).
   - The wording of the staff invitation for non-technicians (TM-06).
5. **Physical test:** the §7 sheet on the ASUS 27-inch. Then record a `device_test`.
6. **Vietnamese review:** sections A50–A55 in `docs/i18n/VI_NEW_STRINGS_FOR_REVIEW.md`.

Production deployment, production migrations, live SMS, carrier registration and billing changes were **not** done and need your separate approval.

## 7. Physical touchscreen test sheet (QA-04): pending, not passed

Setup: ASUS 27-inch, Windows, Edge or Chrome at **100% zoom**, maximized, taskbar visible, staging build. For each line, mark Pass/Fail, then add a photo or a note.

| # | Screen | Check |
|---|---|---|
| 1 | Customer Retention | No page scroll. Tap As of Date, pick 2 dates, Compare. Branch filter changes counts and the label. Book Appointment opens Booking with the customer preselected. |
| 2 | Customer Retention → campaign preview | The SMS estimate shows segments and a total, or "Price unknown". **Do not send.** |
| 3 | Phone & Caller ID / Messaging Setup | The SID shows `AC…1234`. The branch selector shows only your branches. Refresh Status works. Registration and toll-free state are shown. |
| 4 | Team Management | 10/20/50, then refresh and Back/Forward keep the page. Customer search by phone works. Add a receptionist: she appears first and highlighted. The Live indicator shows. |
| 5 | Team profile | Birthday edit (month/day), Training tab, preferred-technician check shows alternatives. |
| 6 | AI Usage & Limits | Cost dialog shows estimate vs finalized / paid / due. Package Details → Settings shows branches Inherit / On / Off. |
| 7 | Setup Health | Run Health Check. Counts match the rows. Acknowledge an alert. Guided buttons open the right screen. Nothing shows Ready that you know is not set up. |
| 8 | Touch (all screens) | Every button works with a finger on the first tap; dialogs close with ✕; no text cut off in English or Vietnamese. |

## 8. Security review summary

- **Tenant isolation:** every new SQL statement carries the session's `tenant_id` (tenant gate passes). Cross-tenant tests exist in every module.
- **Branch scoping:** authorized branches come from the session (`authz.branchIds`), never the request body. The API client refuses to send `tenantId` / `branchId` in a body.
- **Permissions:** permission-based (role-checks gate passes). Staff creation cannot grant a role at or above the actor's own.
- **Twilio secrets:** SIDs are masked everywhere, tokens are never returned, and the full SID needs a step-up and is audited.
- **PII:** customer phones are masked in Team search, never put in URLs, and not in the Setup Health payload. Birthdays are private by default and stored without a year.
- **Finance:** no charge, refund or payout path was added. Invoice reconciliation is read-only by construction. Tax goes through the single `taxCents` authority.
- **Audit:** every new write that changes settings, staff, pricing, branch AI settings or release evidence is audited in the same transaction.
