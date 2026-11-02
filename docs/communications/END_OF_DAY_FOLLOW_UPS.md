# End-of-Day Follow-Ups — build handoff (guide 12 of 20, 31 Oct 2026)

Source: *AI PowerSalon End-of-Day Follow-Ups — Claude Build Guide* (Oct 30 2026). Route kept: `/settings/follow-ups` (settings +
management center) and `/follow-ups` (the existing queue). Built in place on the existing module
`modules/communications/src/end-of-day-followups/` — no second queue, scheduler, send path or customer database.
Local commits only; nothing pushed, deployed or sent. Migration **745** is on the local test template only.

## 1. Scheduler investigation (guide §6 — highest priority)

| Question | Answer from the code |
|---|---|
| Is the 8 PM job registered and run by a worker, independent of the browser? | Yes. `DailyFollowUpScheduler` (critical job class, every 5 min, `runTick` lease) calls `runDueBranches(now)`, which generates for each active branch whose **branch-local** time has passed its generation time and has no completed run for that local date. The harness proved the real gate on a controlled clock: 7:59 PM → no run; 8:01 PM → run; 8:30 PM → no second run. |
| Why can the queue show zero? | Correct zeros: no completed service line for that branch-local date; lines without a technician or customer; the branch's salon suspended; feature turned off. Every run now stores **candidates · created · excluded · reasons · rule version · timezone · generation time · run key**, and the center's run log and health rows show them, so a zero is explained instead of hidden. |
| Generation idempotency | One run row per (tenant, branch, local date); tasks keyed by the live (line, technician) unique index; `ON CONFLICT DO NOTHING`. The race lane proves four simultaneous runs (two workers + Generate Now) → each line once, one run row, one alert per technician. |
| **P0 found: expiry erased history** | The 24-hour sweep *soft-deleted* unsent tasks (`deleted_at`), which hid them from every view **and freed the unique index**, so the same service line could be generated again; a second job (`purgeExpiredTasks`) then **hard-deleted** them after 30 days. Fixed: expiry is a status change (`expired`, `expired_at`, reason `expired_after_24h`) that keeps the row; the purge job and its repository method are **removed**. Migration 745 restores previously hidden expired rows except where the line was regenerated since. |
| Expiry vs send race | The send claims the task under a row lock inside one transaction; expiry only moves unsent states. Race lane: send ×2 + sweep at once, 6 rounds → always exactly one outcome, never a message after expiry. |
| Age basis of "After 24 hours" | Age since **generation** (`created_at`) — unchanged from the previous implementation, documented here and in the setting's hint. |

## 2. Customer contact protection (guide §8)

One eligibility rule (`eod-center.ts loadEodCandidates`) is used by **both** the 8 PM generation and **Preview Tonight**. A line does not become a task when:

- **already_generated:** the line already has a task.
- **customer_archived:** the customer is archived.
- **already_booked:** the customer has an upcoming booking. This uses Retention's definition: booked / confirmed / arrived / checked_in / waiting, from the salon's today.
- **recently_contacted:** the customer received a follow-up inside the branch's **contact cooldown** (new setting, default 24 h, 0 = off).

At **send time** the same protections are re-checked inside one transaction, which takes:

- a row lock on the task;
- a per-customer advisory lock, so two technicians' tasks for the same client cannot both pass the cooldown;
- the lifecycle guard;
- the Customer App message insert;
- the domain event.

A **manager exception** (written reason ≥ 5 characters, audited, stored on the task) may override `already_booked` and `recently_contacted`. Nothing overrides an archived customer or a missing Customer App account.

The race lane uses a deterministic gate, an exclusive lock on `customer_notifications`:

- With the advisory lock: one sent and one refused.
- With the lock removed (mutation check): the test fails (3/4).

## 3. What was built

| Area | Change |
|---|---|
| Settings | The 7 photographed settings unchanged in meaning; **+ contact cooldown**. Settings / save now raw SQL (scheduler, send and center share it). |
| Approval | New **Reject / Return to technician** with a required note (`rejected` state, `manager_note`); the technician edits and resubmits; Approve records `approved_by_user_id`. Every decision audited. |
| Send | `claimAndSendTask` (see §2); refusals return registry codes `FOLLOWUP_ALREADY_BOOKED`, `FOLLOWUP_RECENTLY_CONTACTED`, `FOLLOWUP_CUSTOMER_ARCHIVED`, `FOLLOWUP_EXPIRED`, `FOLLOWUP_OVERRIDE_REASON_REQUIRED`, `FOLLOWUP_REJECT_NOTE_REQUIRED` (EN + VI text). |
| Technician alerts | One `daily_followup_ready` alert per technician per business date — a re-run or manual top-up never alerts twice. |
| Center API `pos/eod-follow-ups/*` | `summary` (KPIs from the queue: pending / awaiting / returned / sent today / not delivered / expired today / booked-after-follow-up 30 d labelled as association), `health` (scheduler + expiry heartbeats from `scheduler_runs`, last generation, template, Customer App delivery, SMS **Not used**, email **Not used**, technician alerts, approval queue — Ready only from evidence), `preview` (read-only), `runs`, `tasks` (search name / phone digits / technician / service / ticket number / exact task·ticket·appointment·customer id; status groups; approval; technician; date basis generated / service date / sent / expired with salon-local From–To; newest first or due-first queue; pages 10/20/50), `tasks/:id` (detail + audit timeline + Customer App delivery/read + booked-after), `send` / `approve` / `reject`. Permission `customers.edit` (unchanged). |
| POS screen | `EndOfDayFollowUpSettings.tsx` rebuilt in place: header (Refresh, Open Queue), six KPI cards, settings, health + **Preview Tonight**, activity (search, filters, month calendar, pager, rows 10/20/50), run log, details overlay (Approve, Return with note, Send / Send anyway with reason, Open customer, Book appointment, Close). EN + VI (`ns/eodfollow.*`, prefix `eod.`). |
| Technician App | `Returned` state with the manager's note and *Edit & Resubmit*; filters Awaiting approval / Returned / Expired; expired tasks say they can no longer be sent. **Removed a false claim**: it said "Sends as a text message" for clients without the app — nothing in this workflow sends texts; it now says the follow-up cannot be delivered. English only. |
| Pre-task | `comms` E2E 11/12 root cause: three POS i18n namespace **key collisions** (Phone Number Management reused `pm.*`; Tips vs Team Performance `tp.searchPh`; money vs phonemessaging `pm.scope.salon`) — wrong text on 3 screens. Fixed, and new gate `check:i18n-ns-collisions` (commit `b8d4f8be`). |

## 4. Handoff table (guide §20)

| Item | Status | Evidence |
|---|---|---|
| All seven settings + cooldown persist / reload / audit | COMPLETED_AND_VERIFIED | pgtest (save/reload, timezone override kept); E2E step 1 (saved values on screen = DB) |
| 8 PM generation (correct eligible tasks, diagnostic counts) | COMPLETED_AND_VERIFIED (local) · staging BLOCKED_EXTERNAL | pgtest (DST day boundary, exclusions, run record); E2E controlled clock 7:59 / 8:01 / 8:30; race lane (4 runs at once) |
| Preview Tonight read-only, matches the run | COMPLETED_AND_VERIFIED | pgtest + E2E: preview count = created; tasks / messages / alerts / runs unchanged |
| 24-hour removal keeps history, no stale send, race tested | COMPLETED_AND_VERIFIED | pgtest (pending / awaiting / returned expire as status, not sendable, migration repair); race lane |
| Technician notifications (one per list) | COMPLETED_AND_VERIFIED (DB rows) · device push not tested | pgtest + race lane + E2E alerts = 2 |
| Approval + editing + revision audit | COMPLETED_AND_VERIFIED | pgtest end-to-end; E2E return with note → approve |
| Customer protection (opt-outs/booked/cooldown/duplicates) | COMPLETED_AND_VERIFIED for Customer App delivery | pgtest + race lane (mutation-checked) + E2E exception flow |
| Search / date basis / Page 1-2-3 | COMPLETED_AND_VERIFIED | pgtest + E2E (24 rows over 3 pages) |
| Delivery / replies | Customer App: COMPLETED_AND_VERIFIED (inbox row + read time) · **SMS / email delivery for follow-ups: NOT_IMPLEMENTED** (the existing workflow is in-app only; health shows SMS/Email "Not used") | detail overlay; health rows |
| UI / staging | Browser viewports COMPLETED_AND_VERIFIED (1920×945, 1536×864, 1440×900, 1366×768, 1024×768, no sideways scroll) · physical ASUS 27″ BLOCKED_EXTERNAL · POS / API / Tech type-check and the rewritten POS unit test IMPLEMENTED_NOT_VERIFIED (CI) | E2E step 9 |
| Migration 745 staging / production | BLOCKED_EXTERNAL (owner approval) | applied twice to the local template (idempotent) |

Rollback: see the header of `745_eod_follow_up_center.sql`. Feature behaviour can be turned off per branch with the existing *Enable* setting.

## 5. Hand-offs to later guides

- **13 Follow-Up Queue:** owns `/follow-ups` (`POSFollowUpsScreen` / `FollowUpQueuePanel`). Reuse `pos/eod-follow-ups/tasks?sort=due&status=unsent` (due-first operational order) and the same send / approve / reject routes. Keep missed-call follow-ups distinct (`/tenant/ai/receptionist/follow-ups` is a different workflow).
- **14 Appointment Reminders / 15 Email:** if SMS or email delivery is added to follow-ups, route it through the existing tenant messenger with marketing consent, opt-out and quiet hours, and show it in the health rows that read "Not used" today.
- **Templates:** the follow-up message templates are still the built-in keys (`FOLLOW_UP_TEMPLATES`); binding to salon templates (`resolveBoundTemplate`) is not done.

## 6. Open owner decisions

1. **Contact cooldown default 24 h** (a client served by two technicians on one day receives one follow-up; a manager can override with a reason). Keep 24 h, or another default?
2. **Front Desk** holds `customers.edit` in the current role policy, so it sees and acts in this center (approve / return / send exceptions). Keep, or restrict approvals to managers?
3. **SMS / email delivery** for clients without the Customer App: build it (needs marketing consent + carrier registration), or keep in-app only?
4. `service_follow_up_tasks` was re-classified **HIGHLY_SENSITIVE** by the ownership heuristic (new free-text manager-note / reason columns). Confirm.

## Harness fix (Oct 31 2026, during guide 15): the time-of-day-dependent "Finn already got one today" step

- **Root cause 1:** `/__eod?tech=1` submitted "the first pending task of technician 1 by `created_at`". One generation run creates every task in **one transaction**, so the tasks share `created_at` and the pick was arbitrary. When Ava's task was approved instead of Finn's, Finn had not "already got one", and the cooldown step legitimately sent instead of refusing.
- **Root cause 2:** services were seeded "15–60 minutes ago". Between 00:00 and 01:00 salon time they fall into **yesterday's** business date.
- **Fix:**
  - The harness seeds fixed salon-local times on the business date (10:00–10:45).
  - It submits tasks by customer (`tech=ava`, then `tech=finn`, explicitly ordered by `created_at, id`).
  - No product code changed, and no check was weakened.
- **Evidence:** `eod` 9/9 at 07:48 local; combined run 162/162 (see `docs/communications/EMAIL.md`). A real midnight run was not performed, because no clock-faking tool exists here; the seeded data no longer depends on the real clock.
