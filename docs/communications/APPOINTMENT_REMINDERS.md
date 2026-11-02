# Appointment Reminders — Complete Build & Repair (guide 14 of 20, built 31 Oct 2026)

Source: *AI PowerSalon — Appointment Reminders Complete Build & Repair Guide* (13 pages, Oct 30 2026). Screen:
Communications → Appointment Reminders, `/tenant/communications/reminders`. Local commits only — nothing pushed, deployed
or sent. Migration **747** is applied to the local `aps` test template only.

Statuses used below (guide §19): **Completed & Verified** (built and executed here) · **Implemented but Unverified**
(written, needs CI / staging) · **Blocked by External Setup** · **Not Implemented**.

## P0 audit — what the existing engine actually did (guide §2 "do not reinterpret the Send Window")

- **Engine.** `RemindersService.runDueReminders` is *scan-based*: every run reads the CURRENT booked appointments
  (`pos_tech_appointments.status = 'booked'`) and sends for those whose start lies in the half-open window
  `[now + lead, now + lead + window)`. Runs: the in-process `ReminderLadderScheduler` every **5 minutes** (only when
  `REMINDER_CRON_ENABLED=1`; off by default so dev/test/CI never text anyone) and the secret-guarded
  `POST /jobs/appointment-reminders` for an outside cron.
- **Send Window = 60 minutes (documented, unchanged).** It is the width of the firing window, not a delay: an appointment
  is reminded by the first run that sees it no more than `lead + window` away — i.e. between **24 h and 25 h** before it
  with the defaults. With a 5-minute cadence that is normally 24 h 55 min – 25 h before. A rung's window is capped at the
  rung itself (a 30-minute rung looks at most 30–60 minutes ahead). If no run reaches an appointment inside its window
  (scheduler off / down), it is **never sent late** — now shown as *Missed its window* (guide §7.1 short-notice / late).
- **Defects found and fixed (P0 correctness, guide §7.2 / §8):**
  1. **Duplicate sends under overlap.** The idempotency ledger `appointment_reminders_sent` was written only AFTER the
     send (read sent-set → send → mark), so two overlapping runs (scheduler + `/jobs` route, or two instances) could both
     send. The real-Postgres race test reproduces it: with the claim guard removed, 3 of 4 race tests fail.
  2. **Reschedule lost the reminder.** The ledger key was (tenant, appointment, rung): once a reminder went out for the
     old time, the NEW time never got one. Now the key includes the **occurrence** (salon-local date + start time).
  3. **No pre-send re-check.** A cancellation between selection and the provider call was not re-checked. Now the claim
     locks the appointment row and re-validates; a second re-check runs right before the provider call.
- Opt-outs, credits and the `+country` check stay where they were: in `NotificationsService.send` (the one send path).

## Implementation

**Dispatch protocol (no parallel engine — the same service, repository and send path):**
`claim` (under the appointment's row lock: still booked, same occurrence, in the future → insert the occurrence, or
re-claim a *retryable* failure after backoff / a quiet-hours deferral) → `revalidate` (right before the provider call;
changed → `cancelled: appointment_changed`) → `NotificationsService.send` → `finish` (state + reason + notification link
+ an append-only event). A durable per-salon run record is written for every run.

| State (`appointment_reminders_sent.state`, machine `REMINDER_DISPATCH`) | Meaning |
|---|---|
| *(derived)* scheduled · short_notice · missed_window | pending reminders are NOT rows: they are computed from the live appointment, so a reschedule moves them and a cancellation removes them by definition |
| claimed | a run holds it now (claims older than 15 min are recovered: appointment changed → cancelled; else failed `interrupted_unknown`, **never auto-retried**) |
| submitted | the provider accepted the request — **not** "delivered". Sent / delivered / undelivered come from the provider's own status on the linked `notifications` row (741 delivery events); `simulated` = test mode |
| failed | engine / provider failure with a reason. Automatic retry only for transient reasons (`provider_error`, `over_limit`, `not_configured`, `send_failed`), at most 3 attempts, 10-minute backoff steps, inside the window |
| skipped | `opted_out` (terminal, never retried), `no_destination`, `quiet_hours` (policy *skip*) |
| deferred | quiet hours with policy *defer*: sent when quiet hours end, if the appointment is still ahead and unchanged |
| cancelled | `appointment_changed` (rescheduled / cancelled after the claim) or `staff_cancelled` |

**Quiet hours** (guide §7.2, §9): the existing Super Admin Smart Reminders timing config for `upcoming_appointment`
(`reminder_timing_defaults`: the salon's row, else the platform default; a `reminder_tenant_overrides` policy wins). Nothing
configured → no quiet hours (today's behaviour). Evaluated in the salon's time zone.

**Files**
- Migration `apps/api/db/migrations/747_appointment_reminder_center.sql` (additive; rollback in its header):
  `appointment_reminders_sent` becomes the dispatch record (id, occurrence_key, state, reason, channel, branch, customer,
  intended / start instants, notification link, attempt count, timestamps; key → (tenant, appointment, rung,
  occurrence)); `appointment_reminder_attempts` becomes the event trail (dispatch link, kind, actor, idempotency key,
  occurrence, note; statuses widened); new `appointment_reminder_runs`; indexes for the queue / history / customer reads.
  Legacy rows are backfilled as `submitted · legacy_ledger` at the appointment's current time (no re-send). `NOT NULL`
  contract deferred to a later release (expand → backfill → contract).
- Backend (`modules/communications/src/reminders/`): `reminder-core.ts` (occurrence, window, quiet hours, outcome rules,
  reason texts) · `reminders.repository.ts` (dispatch port) · `reminders.kysely.repository.ts` (`KyselyReminderDispatch`)
  · `reminders.service.ts` (`runTenantDispatch`, shared `sendClaimed` / `compose`) · `reminder-ladder.scheduler.ts`,
  `reminders.controller.ts` (run trigger recorded) · **new** `reminder-center.ts`, `reminder-center.controller.ts` ·
  `reminders.module.ts`. Also `communications-lifecycles.ts` (`REMINDER_DISPATCH`), `request-schemas.ts`, 9 error codes in
  `packages/api-contracts/src/errors.ts`.
- POS: `screens/POSRemindersScreen.tsx` (rebuilt in place; exports `CustomerReminderHistory`),
  `screens/POSCustomerProfileScreen.tsx` (Reminder History section), **new** `api/posReminderCenterApi.ts`,
  `i18n/ns/remind.{en,vi}.ts` (159 keys each), `i18n/ns/errors.{en,vi}.ts`, `i18n/ns/index.ts`, `styles.css`. Test
  `POSRemindersScreen.test.tsx` rewritten (the old `.403` test folded in).
- Generated: `kysely.types.ts`, `actor-columns.generated.ts`, ownership registry, state vocabularies, openapi manifest,
  attack-surface docs, owner/tech error catalogs.
- Harness: `tooling/catalog-one-screen/rmd-extra.mjs`, `interact-rmd.mjs` (wired into `live-server.mjs` /
  `interact.mjs`); screenshots in `results/rmd-e2e/`.

**API (guide §13)** — `pos/reminder-center/*`, tenant and branch from the session only; reads need
`communications.view`, actions `communications.manage` (owner decision on record: Front Desk keeps full communications
control); plan feature `smart_reminders` as before. Settings stay on `GET/PATCH /pos/reminders`.

| Route | Purpose |
|---|---|
| `GET kpis?preset&from&to&branchId` | six counters, each on its written basis (below), salon time zone |
| `GET reminders?tab&q&channel&branchId&basis&preset&from&to&page&pageSize` | Upcoming (earliest due first) or history tabs (newest created first, `created_at DESC, id DESC`); 10/20/50; exact totals |
| `GET reminders/:id` | details: rule, template source/version, attempts with reasons, provider delivery events (`u:<appointment>:<rung>` for an upcoming one) |
| `POST reminders/:id/cancel {reason}` | Cancel Pending (not yet sent), audited |
| `POST reminders/:id/retry {idempotencyKey, reason, confirm, acknowledgeDuplicateRisk?}` | Safe Retry (below), audited |
| `GET health` | scheduler · Twilio · email · booking sync · delivery reports |
| `GET customers/:customerId/reminders?page&pageSize` | the customer's reminders newest first, each with its event trail |

**KPI bases (guide §14).** Scheduled = intended send time in the period, not run yet · Sent = provider accepted, by
acceptance time · Delivered = provider-confirmed, by delivery time — **Unknown (null), not 0**, while no delivery report
was ever received · Failed = engine failures + provider undelivered, by the time recorded · Cancelled = by the time
recorded · Upcoming Today = due for dispatch today (not every appointment today).

**Safe Retry (guide §11).** Only a *failed* reminder, or a *skipped* one whose cause can be fixed (`no_destination`,
`quiet_hours`) — never an opt-out, never one the provider accepted. Re-checks: the appointment is still booked at that
occurrence and more than 15 minutes away; a destination exists; the provider is ready (SMS: the salon's Twilio row
validated with a sender; "Connected" alone is not proof); a reason (3–300 chars) and an explicit confirmation; an
`interrupted_unknown` one also needs the duplicate-risk acknowledgement. One guarded transition → claimed (a concurrent
second retry is refused), idempotent by key (the same key replays), the original failure stays in the trail, audit row.
No batch retry.

## Feature status

| Feature (guide) | Status | Evidence |
|---|---|---|
| Existing settings kept: toggle, 24 h lead, 60-min window, SMS, Save (§1, §19) | Completed & Verified | E2E rmd step 1 (DB 120 → 1440); unit test (CI) |
| Send Window semantics documented, unchanged (§2, §7.2) | Completed & Verified | this doc; pgtest "outside the window"; screen note |
| Reschedule / cancellation protection (§4.1 owner priority 1) | Completed & Verified | pgtest (new occurrence after reschedule; cancel between claim and send → never sent); race spec (reschedule vs re-check, 10 rounds) |
| No duplicates across overlapping runs / retries (§8, §16 Concurrency) | Completed & Verified | race spec 8 runs × 4 sessions; mutation check (guard removed → 3/4 fail) |
| DST-safe due time (§7.2, §16) | Completed & Verified | pgtest: Mar 14 2027 09:00 EDT reminded exactly 24 h before (08:00 EST) |
| Opt-out, missing contact, quiet hours defer / skip (§9, §16 Consent) | Completed & Verified | pgtest; E2E (Cara STOP) |
| Bounded automatic retry with backoff; interrupted-send recovery (§8) | Completed & Verified | pgtest |
| Delivery health + Safe Retry (§11, §4.2 owner priority 2) | Completed & Verified | pgtest (provider not ready → refused; health "failed"); E2E (Ben fixed → retry ×1); race (two retries → one) |
| Six KPI cards on written bases, Unknown not 0 (§4, §14) | Completed & Verified | pgtest; E2E (screen = DB; Unknown → 1 after a signed report) |
| Search name / phone / email / technician / appointment / reminder ID, server-side beyond page 1 (§5.1) | Completed & Verified | pgtest; E2E |
| Month From/To calendar, presets, explicit date basis, tenant-local half-open (§5.2) | Completed & Verified | pgtest (custom range on appointment basis); E2E (calendar, basis label) |
| Numbered pages 10/20/50; history newest first; upcoming earliest due first (§5.3) | Completed & Verified | pgtest; E2E (10 + 6) |
| Reminder Details overlay with Close, Open Customer / Booking (§6) | Completed & Verified | E2E; Booking opens the calendar (the Booking screen takes no deep link — same limit as guide 10) |
| Customer reminder history (§10, §4.3 owner priority 3) | Completed & Verified (API) · Implemented but Unverified (profile UI) | pgtest; E2E calls the profile section's API; the profile screen needs `GET /pos/customers/:id`, which the harness does not serve — unit test (CI) |
| Tenant / branch isolation, audit (§15, §16 Security) | Completed & Verified | pgtest (another salon sees / opens / acts on nothing); audit rows for cancel / retry |
| EN/VI POS, layout 1920×945 … 1024×768 without sideways scroll (§4, §15) | Completed & Verified (browser) | E2E step 7 |
| Real Twilio delivery, status callbacks, carrier registration (§9.1) | Blocked by External Setup | only the recording stand-in ran; no live provider |
| Email provider sender / bounces (§9.2) | Blocked by External Setup | `SENDGRID_API_KEY` not set here; email shows test mode |
| Channel "Both" with independent attempts (§6, §9.2) | Not Implemented | the settings allow SMS or Email; adding Both needs a second attempt per occurrence — owner decision |
| Confirm / cancel by SMS reply (C / Y) | Not Implemented | no inbound confirm keyword exists; the reminder text says "Reply to reschedule" (inbox) |
| Reminder-specific test send (§4 header) | Not Implemented | "Test reminder" opens Text Messaging Setup's confirmed test text |
| Realtime refresh (§P2) | Not Implemented | Refresh button + reload after actions |
| Physical ASUS 27″ at 100 % zoom (§16 UX) | Blocked by External Setup | browser viewports only |
| POS / API type-check, POS unit test, lint / boot / api-contract / strict-bodies-types | Implemented but Unverified | need CI (no node_modules here) |
| Migration 747 on staging / production | Blocked by External Setup | owner approval |

## Tests (31 Oct 2026, this workspace)

| Command | Result |
|---|---|
| `FST_PG_TEMPLATE=aps REPO_ROOT=$PWD bash tooling/full-system-test/unit-standin/run.sh $PWD modules/communications/src/reminders/reminder-center.pgtest.vitest.spec.ts` | **19/19** |
| same runner + `PG_RACE_URL=postgres://postgres@127.0.0.1:55432/rem_race` (a copy of `aps`) `…/reminder-dispatch.postgres-race.vitest.spec.ts` | **4/4** on real PostgreSQL 16, 4 sessions; claim guard removed → **1/4** |
| Regression: reminder-core 14/14 · reminders-service-core 27/27 · ladder 4/4 · language 3/3 · push pgtest 1/1 · push 5/5 · reminders-400 1/1 · customer-notifications pgtest 18/18 · message-templates pgtest 17/17 · smart-reminders-core 6/6 · suspended-salon-comms 2/2 | all pass |
| `node tooling/catalog-one-screen/interact.mjs rmd-e2e rmd` | **7/7** (Chromium; 5 viewports; EN/VI) |
| Combined `seg,cp,do,promo,cc,mg,mt,cn,pm,bv,ms,eod,fuq,rmd` | **152/153** — the failing step is `eod` "customer protection at send time … Finn already got one today" (first send says Done). It fails the same way with this guide's changes stashed (baseline run), so it is a pre-existing, time-of-day-dependent harness case, not a regression |
| `comms` section | **12/12** |
| All 62 `check:*` gates (see `docs/GATES_2026-10-31.md`) | 52 pass via npm; 6 pass through the stand-in (sql-prepare, types drift, sql-identifiers, db-ownership, unique-review, actor-stamp); 4 can't run here (lint, boot, api-contract, strict-bodies-types). First run flagged tenant (branch join), silent-catch, as-any, raw-sql-inputs, migration-safety (NOT NULL → deferred), response-exposure (whole-row reads), state-transitions (vocab) — all fixed in code, none allowlisted |

## Rollout / rollback

1. Deploy 747 (additive; legacy rows backfilled, no re-send). 2. The code reads the new columns immediately; the
scheduler stays OFF unless `REMINDER_CRON_ENABLED=1` (or an outside cron calls `/jobs/appointment-reminders`).
3. Watch the health panel: Scheduler (run record), Delivery reports (Unknown until callbacks arrive). Rollback: deploy the
previous build — it reads `appointment_reminders_sent` by (tenant, appointment, rung) and only inserts; the 747 columns
are ignored. Reverting the schema (header of 747) needs de-duplication first.

## Hand-offs

- **Guide 15 (Email):** email reminders already go through `NotificationsService` (test mode without a key); bounce /
  delivery events for email would feed the same `notifications` status the center reads.
- **Message Templates (guide 7):** the reminder sender still reads the bound template (`resolveBoundTemplate`); details
  show the template version actually used (`pos_message_template_usage`).
- **Booking (outside these guides):** a deep link to one appointment would make Open Booking exact.

## Open owner decisions

1. Add a **Both** channel (SMS + email, independent attempts)?
2. Should customers be able to **confirm by replying** (e.g. C / Y), and what should that do?
3. Turn on the **in-process scheduler** (`REMINDER_CRON_ENABLED=1`) in production, or keep an outside cron?
4. Ownership heuristic reclassified `appointment_reminder_attempts` as **HIGHLY_SENSITIVE** (new note / actor columns) — confirm.
