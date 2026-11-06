# AI Scheduling Optimizer — implementation report (guide 16, Nov 2 2026)

Route: `/tenant/ai/scheduling-optimizer` (POS, EN/VI). Engine: `modules/ai/src/ai-scheduling-optimizer` (migrations 345 / 528).
The Booking Calendar still owns every appointment. The optimizer reads the calendar, checks the hard rules and makes
suggestions. A change is applied only through `BookingService`, and only after a staff decision and, for a confirmed
booking, the customer's approval.

## Audit — what was already built and verified

| Area | State | Evidence |
|---|---|---|
| Deterministic engine (gaps, conflicts, hard rules before scoring) | Verified | `ai-scheduling-constraints.ts`, `-detection.ts`, `-day.ts` + specs |
| Staff decisions with CAS (expectedVersion), append-only decision rows | Verified | `ai-scheduling.service.ts` `decide`, `schedule_recommendation_decisions` |
| Customer approval through proposals (SMS / app / staff-recorded) | Verified | `ai-scheduling-proposals.ts`, `customer/schedule-proposals` |
| Apply through Booking, idempotent, refuses on a moved appointment (STALE_SCHEDULE) | Verified | `ai-scheduling-application.ts`, `schedule_change_applications` |
| Expiry sweep, nightly scans, insights jobs | Verified | `ai-scheduling-jobs.ts` |
| Automation limited to safe actions; never a confirmed booking | Verified | `ai-scheduling-automation.ts` |
| Super Admin platform stop | Verified (read path fixed, see below) | `ai-scheduling-ops.platform-switch.ts`, super-admin module |
| Four photographed counters | **Partial → fixed** | see below |
| Searchable, paged recommendation queue | **Missing → built** | `center/recommendations` |
| History as an event trail | **Partial → built** (runs only) | `center/history` |
| One-click health checker | **Missing → built** | `center/check` |

## Defects fixed

1. **The emergency stop failed open when the process was cold.** `SchedPlatformSwitch` started as "not stopped". If the
   first read of `platform_settings` failed, it answered "not killed", so generation and automation could run while a
   platform stop was on. Now an unreadable switch that has never been read counts as **stopped**. The last known value
   is kept on later failures, as before. Test: `ai-scheduling-ops.vitest.spec.ts` ("never read fails closed").
2. **The job dispatcher dispatched scans when the stop could not be read.** `platformKilled()` swallowed the error and
   used `.catch(() => no rows)`. The error now fails the dispatch tick, and the next tick retries.
3. **The settings view showed "not stopped" when the switch read failed.** `.catch(() => false)` is now `.catch(() => true)`.
4. **The "Open recommendations" count was wrong.**
   - It came from three `limit=1` list calls in the browser.
   - It counted only `review_required`. Rows that were accepted but not applied, returned for changes, or customer-approved were left out.
   - It counted suggestions past their expiry until the sweep ran.

   The server now computes the count with one definition: waiting on staff and not expired. Rows past expiry are shown
   apart and are never "open".
5. **"Awaiting customer approval" counted rows whose proposal was never sent.** It now needs a live proposal
   (`proposed` / `customer_notified`, not expired).
6. **"Automatic optimization" showed "Off" when the settings could not be read.** It now shows the effective mode:
   on, off, module off, emergency stop, platform stop, or **unknown**.
7. **The recommendation list stopped at 50 rows.** It had no search, no date range, no pages, and gave no sign that the
   appointment had moved since the suggestion was made.

## What was added (read side only — `/pos/ai-scheduling-optimizer/center/*`, `ai_scheduling.view`)

- **`GET summary`**
  - The four counters, each with its definition.
  - The module's parts: switch, emergency stop, platform stop, subscription, latest scan.
  - The last successful evaluation, using the worker's completion time.
  - Data freshness: last booking change and last time-off change.
  - Open conflicts, apply failures, and rows past expiry.
- **`GET recommendations`** — the recommendation queue.
  - Search by:
    - recommendation ID or ID prefix
    - appointment ID
    - current or proposed technician
    - service
    - customer name or phone digits — only with `customers.view`, otherwise customer fields are null.
  - Groups: open, customer, accepted, applied, failed, closed, stale.
  - Date dimension: created, appointment, decided or applied.
  - Date range: presets, or a custom From/To that is validated and resolved to salon-local days.
  - Pages: 10, 25, 50 or 100 rows, newest first, with `id` as a stable tie-break.
  - Each row gives before and after slots, `stale` (the appointment version or status moved), `appointmentMissing` and `pastExpiry`.
- **`GET history`** — an append-only trail, newest first.
  - Sources: the recommendation row ("generated") plus every row in `schedule_recommendation_decisions`.
  - Classes: staff, customer (`customer_*`) and apply (`queue_application`, `apply_ok`, `apply_fail`, `retry`, `rollback`).
  - Search by recommendation ID, actor name, event or reason, with a date range and pages.
- **`POST check`** — Check Scheduling System. It is read-only and evidence-backed.
  - It runs at most once per salon every 30 seconds (advisory lock).
  - Each run is stored in `scheduling_optimizer_health_runs` (migration 772).
  - Checks:
    - subscription
    - module switches
    - platform stop is readable
    - booking source
    - valid time off
    - shift data
    - scan worker: last success within 36 hours, failures, stuck runs
    - job queue: dead or lagging jobs
    - expiry sweep
    - **nothing applied without a staff decision**
    - **customer approval respected**
    - **no silent change to a confirmed booking**
    - no double apply
    - every applied change has a Booking record
    - open conflicts
    - apply failures
    - tenant isolation
    - no side effects

The center is not behind the AI package gate. When the subscription lapses, the page shows "Subscription restricted"
and keeps the history readable, instead of returning 403 and showing zeros. Branch scope follows the engine's rule: a
branch session sees its own branch, and a salon-wide session sees the whole salon.

## POS

- **Counters.** The four counters sit above the tabs on every tab.
  - Each counter opens the queue filtered to its group.
  - Module opens its parts.
  - Check Scheduling System opens the read-only results.
- **Overview.**
  - The day's measures and the run button are kept.
  - The newest recommendations fill the space that was blank.
- **Recommendations.**
  - The searchable, paged queue: month calendar range, presets, and which date the filter uses.
  - Rows show "Schedule changed — reload and re-review" when the appointment has moved.
  - "Suggest a better time" is kept.
- **History.** The event trail sits above the existing run history.
- **Tab strip.** It scrolls sideways when the screen is narrow, instead of wrapping.
- **Strings.** All new strings are `scx.*` in EN and VI (`apps/pos-web/src/i18n/ns/schedcenter.*`).

## Tests

- `scheduling-center.pgtest.vitest.spec.ts` — 11 tests against the real migrated schema.
  - Covered: counters, groups, stale, search, customer visibility, dates, history classes, health failures, reuse and isolation.
  - Sabotage checks: dropping the expiry filter, the customer gate, or the customer-approval rule each turns a test red.
- `ai-scheduling-ops.vitest.spec.ts` — the cold switch fails closed (sabotage checked).
- `POSAISchedulingOptimizerScreen.test.tsx` — 28 tests. The old list-filter test was rewritten to the queue. New tests
  cover counters and drill-down, the module parts, unknown mode, health, history, and Vietnamese on the History tab.

## Built Nov 6 2026 (Kevin: "continue finish all")

- **The technician's full day + before/after preview of neighbouring bookings.** `GET …/recommendations/:id/day`
  (`ai-scheduling-day-context.ts`) reads the day fresh at preview time and returns the target technician's shift, breaks
  and every booking before and after the move (the moving booking marked), the bookings right before and after the
  proposed slot with the gap to each, and how many gaps / conflicts the move opens or closes — the same day model
  (detectDay) the optimizer uses. Shown in the recommendation detail ("Technician's day"). Changes nothing.
  Tests: `ai-scheduling-day-context.vitest.spec.ts` (3), the POS detail test.

## Left as it is
- **Utilization and Duration Insights tabs as the guide names them.** These stay inside Insights and Gaps & conflicts.
  The utilization formula is the one shared formula, `workforce/tech-utilization`.
