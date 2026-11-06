# AI Follow-Ups & Human Handoff Center — guide 26 of 27 (Oct 31 2026)

Source: *AI PowerSalon AI Follow-Ups Complete Claude Build Guide* (16 pages). Route kept: `/tenant/ai/receptionist/follow-ups`.
Status vocabulary (guide §22): COMPLETED_AND_VERIFIED · IMPLEMENTED_NOT_VERIFIED · BLOCKED_EXTERNAL · FAILED · NOT_IMPLEMENTED.

## Root cause — why the Open queue was empty (guide §04)
- **No signed call event created a task.** `ai-calls-ingest.ts` (guide 22) merged Retell `call_started / call_ended / call_analyzed` into
  the call record but never asked whether a human was needed. The only path to a task was the agent's own handoff tool
  (`POST /api/ai-receptionist/v1/handoff`), and only when no live transfer existed. A failed transfer, a callback asked for in
  the post-call analysis or a complaint left **no task at all**.
- **Duplicates were only blocked while open.** Migration 303's partial index allowed one OPEN task per call, so a webhook retry
  after resolution re-created the task. It also blocked a second, different task (a complaint) on the same call.
- **The old routes (`tenant/ai/receptionist/follow-ups*`)** wrote status, assignment and notes with no row version, no assignee
  validation (any user id) and no activity history. Notes were concatenated text. There was no branch scope and no due date.
- In the harness, every original chip and empty state was truthful: zero tasks existed because nothing created them.
  Whether production really has none needs staging access (BLOCKED_EXTERNAL).

## What was built (one task system — `ai_receptionist_follow_ups` extended, nothing parallel)
- **Handoff pipeline** (`voice-booking/ai-handoff.ts`), used by BOTH the signed Retell ingest and the gateway handoff tool:
  - **Signals:**
    - A provider-reported transfer that did not connect → `transfer_failed` (callback required).
    - `call_transfer` → `transfer_completed` (**no task**).
    - The salon's post-call analysis fields `custom_analysis_data.callback_requested / handoff_requested / human_requested` → `callback_requested`, and `complaint` → `complaint`.
  - **One `ai_handoff_events` row** per (tenant, source key, kind).
  - **One task per (tenant, `handoff:<call>:<CALLBACK|COMPLAINT>`), forever.** Migration 759's unique `source_event_key` replaces 303's open-per-call index with open-per-call-and-reason.
  - **Caller match:** exactly one customer with the caller's number → linked. Several → `ambiguous` (never merged). None → `unmatched` (call context kept).
  - **Default due:** 120 minutes after creation (open decision below).
- **Center** (`ai-center/ai-follow-up-center.ts`, routes `/pos/ai/follow-ups-center/*`):
  - **KPIs:** Open, Assigned, In Progress, Waiting, Overdue, Resolved (with today), plus the 30-day handoff counts.
  - **Server search:** name, full name, phone digits, email, task ID, call ID, appointment ID, assignee, description.
  - **Filters:** status chip, priority, source (AI / staff / complaint), assignee (me / unassigned / person), overdue.
  - **Dates:** salon-local From/To with an explicit basis (created, due, updated, call, assigned, first response, last contact, resolved). The final day is inclusive through the exclusive next-day boundary, and DST is correct.
  - **Paging and sorts:** pages of 10/20/50; newest-first, priority (overdue urgent first, then oldest) and due sorts.
  - **Create:**
    - Idempotent per request key.
    - Needs a customer (tenant-validated) or a +country number.
    - Linked call and appointment are tenant-validated.
    - Assignee must be active staff in this branch.
  - **Assign, status, note, escalate, priority override:**
    - Every write is row-versioned twice over: `SELECT … FOR UPDATE` plus `version = n` in the UPDATE. Status changes go through `canMoveToSql(AI_RECEPTIONIST_FOLLOW_UP)`.
    - Append-only `ai_follow_up_activity` and an audit event in the same transaction.
    - Resolve needs a resolution category, and a complaint also needs a note. Reopen needs a reason; Waiting needs a note.
  - **Contact attempts:**
    - A phone, in-person or email outcome is recorded as **staff attestation** and labelled so.
    - A **text** is prepared (Reception Copilot preview: +country, opt-out, sender, shared phone), then confirmed through the Copilot's claim-before-run spine. It is recorded with its VERIFIED state: submitted / provider accepted / delivered / failed / blocked. The test sender is always "Submitted (not confirmed delivered)".
    - **Duplicate-text protection:** 4 hours per task. A manager can override with a reason, which is audited.
  - **Overlay:** overview, customer (masked unless the role works tasks), original AI call with its handoff events, contact attempts, booking & messaging, assignments & audit. Close, and Open Booking with the customer preselected. Every open is audited.
  - **Check Follow-Up System:** read-only, 8 domains: voice events, handoff detection, task durability, customer identity, staff assignment, outreach & booking, background jobs, AI subscription. Each check reports one of Ready / Attention / Failed / Not configured / Disabled / Unknown, never a single green. Runs are recorded and rate-limited (30 s).
  - **Priority & Escalation Assistant:**
    - Signals: urgent complaint, overdue callback, failed transfer, repeated missed contact, absent assignee, unassigned.
    - Each comes with evidence. Accept, Dismiss and Escalate are audited; nothing is sent, booked, reassigned or resolved.
  - **Overdue escalation job:**
    - Reconciliation class, every 5 min, single owner.
    - One owner alert per task per rule, `category = 'ai_follow_up'`.
    - Off switch: `AI_FOLLOW_UP_ESCALATION=off`.
- **POS screen** (`POSAIFollowUpsScreen.tsx`, rebuilt in place):
  - The six original chips, + New Follow-Up and Back to Command Center are kept.
  - It adds the KPI row, toolbar, PeriodBar calendar, table, pager, assistant side panel, create overlay, task overlay and health dialog.
  - Text is EN + VI (`ns/aifu.{en,vi}.ts`, 242 keys each). Customer texts are English.
- **Not AI-package gated:** existing and manual tasks stay workable when the AI subscription lapses (T40/T41). New AI-created tasks stop at the source, because the paid voice side stops.
- **Permissions:**
  - View: `ai.use`.
  - Work a task: `ai.use` + `communications.manage` (Front Desk holds both).
  - Priority override and duplicate-text override: `ai.manage` (owner / manager).
- **Retired:** the five `tenant/ai/receptionist/follow-ups*` routes, their request schemas and their 4 client methods. `AiFollowUpService` stays for the gateway handoff, which now uses the durable path.
- **State machine:** `resolved → in_progress` added, so a task can reopen straight to In Progress with a reason (guide §10).

## Pre-task commit (740dc758) — owner decisions on Reception Copilot (guide 24)
All three are recorded as DECIDED in `docs/ai/RECEPTION_COPILOT.md`:
- Front Desk confirms Copilot cancels; no change was needed.
- An expired AI package now blocks Copilot actions, via `@EnforceAiPackage()` on the action routes only.
- The 5-minute review stays.

## Acceptance matrix (guide §19–§20)
| ID | Result | Evidence |
|---|---|---|
| T01 six chips + navigation | COMPLETED_AND_VERIFIED | E2E `fu` step 1 |
| T02 empty Open genuine / not an API error | COMPLETED_AND_VERIFIED | pgtest "Open is genuine"; unit test (empty vs Retry) needs CI |
| T03 All returns every status | COMPLETED_AND_VERIFIED | pgtest; E2E step 3 |
| T04 manual create persists | COMPLETED_AND_VERIFIED | pgtest; E2E step 4 |
| T05 double-tap idempotent | COMPLETED_AND_VERIFIED | pgtest; race (8 concurrent posts → 1); E2E double click |
| T06 new task on page 1 | COMPLETED_AND_VERIFIED | pgtest; E2E step 4 |
| T07–T10 name / phone / email / ID search | COMPLETED_AND_VERIFIED | pgtest |
| T11 shared phone never merged | COMPLETED_AND_VERIFIED | pgtest (ambiguous, unlinked) |
| T12 search beyond page 1 | COMPLETED_AND_VERIFIED | pgtest; E2E step 3 |
| T13 filters | COMPLETED_AND_VERIFIED | pgtest |
| T14 month calendar prev/next/touch | COMPLETED_AND_VERIFIED (shared PeriodBar / RangeCalendar, proven in earlier guides) | — |
| T15 inclusive final day + DST | COMPLETED_AND_VERIFIED | pgtest (Nov 1 2026 fall-back, Mar 8 spring-forward) |
| T16 date basis created vs due vs call | COMPLETED_AND_VERIFIED | pgtest |
| T17 pagination 10/20/50, stable | COMPLETED_AND_VERIFIED | pgtest (no overlap); E2E |
| T18 priority view overdue urgent first | COMPLETED_AND_VERIFIED | pgtest |
| T19 ASUS 27″, 100%, Windows scaling | BLOCKED_EXTERNAL | Chromium only: 1920×945, 1536×864, 1366×768, 1280×720, 1024×768 |
| T20 no horizontal clipping, usable overlays | COMPLETED_AND_VERIFIED | E2E (5 viewports, no sideways scroll) |
| T21 keyboard / focus / touch targets | IMPLEMENTED_NOT_VERIFIED | rows focusable (Enter opens), 44 px buttons; no screen-reader audit run |
| T22 full overlay + Close | COMPLETED_AND_VERIFIED | E2E; pgtest (audited view) |
| T23 assignment validated + audited | COMPLETED_AND_VERIFIED | pgtest (inactive / other branch / technician refused; audit ×2); race |
| T24 lifecycle + reopen | COMPLETED_AND_VERIFIED | pgtest; E2E step 5 |
| T25 resolved needs outcome | COMPLETED_AND_VERIFIED | pgtest (category; complaint note) |
| T26 overdue alert + escalation | COMPLETED_AND_VERIFIED | pgtest (job twice → one alert); race (6 concurrent runs → 1) |
| T27 signed handoff event received | COMPLETED_AND_VERIFIED (logic) / BLOCKED_EXTERNAL (live Retell) | pgtest + E2E via `AiCallsIngest`; signature check covered by the AI Calls pgtest |
| T28 duplicate callback → one task | COMPLETED_AND_VERIFIED | pgtest (retry, analyzed, gateway, after resolution); race (8 concurrent) |
| T29 out-of-order events reconciled | COMPLETED_AND_VERIFIED | pgtest (ended → analyzed → gateway → late retry) |
| T30 failed transfer creates callback | COMPLETED_AND_VERIFIED | pgtest; E2E step 2 |
| T31 completed transfer ≠ request | COMPLETED_AND_VERIFIED | pgtest (no task; event kind `transfer_completed`) |
| T32 no customer match, no false link | COMPLETED_AND_VERIFIED | pgtest |
| T33 call / customer / appointment linked in overlay | COMPLETED_AND_VERIFIED | pgtest; E2E step 2 |
| T34 internal assignment notification tracked | NOT_IMPLEMENTED | staff notification on assignment not built; the overdue escalation is tracked |
| T35 SMS draft needs consent + confirmation | COMPLETED_AND_VERIFIED | pgtest; E2E step 6 (Copilot preview: opt-out, +country) |
| T36 submitted vs delivered | COMPLETED_AND_VERIFIED | pgtest; E2E ("Submitted (not confirmed delivered)") |
| T37 duplicate message + manager override | COMPLETED_AND_VERIFIED | pgtest (blocked → manager override → audited) |
| T38 booking prefill + availability revalidation | IMPLEMENTED_NOT_VERIFIED | Open Booking passes the customer to the existing Booking flow (its own revalidation) |
| T39 booking OTP when configured | IMPLEMENTED_NOT_VERIFIED | unchanged Booking verification (guide 10) |
| T40 lapsed AI stops new paid generation | COMPLETED_AND_VERIFIED (by design) | the center has no package gate; new tasks come only from the paid voice side |
| T41 historical manual tasks accessible | COMPLETED_AND_VERIFIED | pgtest |
| T42 health accurate with Retell not configured | COMPLETED_AND_VERIFIED | pgtest; E2E step 7 |
| T43 health flags callback / worker failure | COMPLETED_AND_VERIFIED | pgtest (orphan callbacks → FAILED; stale overdue → ATTENTION) |
| T44 health causes no billable action | COMPLETED_AND_VERIFIED | pgtest (no text sent) |
| T45 cross-tenant denial | COMPLETED_AND_VERIFIED | pgtest |
| T46 branch + role tests | COMPLETED_AND_VERIFIED | pgtest (viewer cannot work); E2E (Front Desk works; Technician view / refusal) |
| T47 realtime de-duplicated with polling fallback | IMPLEMENTED_NOT_VERIFIED | 45 s polling + Refresh; no task socket event exists yet |
| T48 CI + staging + physical touchscreen | BLOCKED_EXTERNAL | — |

## Tests (Oct 31 2026)
| Suite | Result |
|---|---|
| `ai-follow-up-center.pgtest` | 21/21 |
| `ai-follow-up.postgres-race` (real Postgres, 4 sessions; forced interleaving for the reassignment) | 4/4. Mutation: with the row lock AND the version guard removed, the reassignment race fails (1/4). Either guard alone holds. |
| `ai-follow-up.vitest` (updated for the reopen rule) | 6/6 |
| AI regressions: ai-calls-center 14, gateway 19, gateway e2e 12, tenant-isolation 6, tenant-receptionist 5, audit 1, voice-analytics 7, receptionist-center 16, front-desk-center 16, copilot-center 14, ai-calendar-center 18 | all pass |
| `ai-lifecycles.pgtest` | 6/9 — identical on unchanged HEAD (query builder absent) |
| `request-schemas.vitest` | 1/104 — identical on unchanged HEAD (stand-in decorator metadata). Its four retired follow-up cases were replaced by the new routes; the six new body schemas were checked directly with `validateBody` (good bodies accepted, bad refused). |
| Browser `rcc,fu` | 18/18 |
| Combined browser run (26 sections incl. `fu`) | 263/263 (one known harness page error after Open Booking: "not in the harness") |
| `comms` section | 12/12 |

## Not verified / blocked
- **IMPLEMENTED_NOT_VERIFIED (CI):** POS / API type-check; `POSAIFollowUpsScreen.test.tsx` (rewritten); lint, boot, api-contract, strict-bodies-types.
- **BLOCKED_EXTERNAL:**
  - Live Retell → webhook → task: needs the signing key, webhook registration and the agent's post-call analysis fields (`callback_requested`, `complaint`) configured by the owner.
  - Real SMS delivery.
  - Staging data behind the empty screenshot.
  - Migration 759 on staging / production.
  - The physical ASUS 27″.
- **NOT_IMPLEMENTED:** staff notification on assignment (T34); a realtime task event; CSV export.
- **Out of scope, noted:** `request-schemas.vitest.spec.ts` still lists the agent routes guide 23 retired (`createAgent`, `updateAgent`, `setStatus`), so CI will fail those cases until they are moved to the front-desk-center routes.

## Open owner decisions
1. Default time to first contact for an AI-created callback: 120 minutes. Change it, or make it a salon setting?
2. Duplicate-text window: 4 hours per task. Keep it?
3. Should staff get an in-app or SMS notification when a task is assigned to them (T34)?
4. Configure the Retell agent's post-call analysis fields `callback_requested` and `complaint`? Without them, only failed transfers and the agent's own handoff create tasks.

## Built Nov 6 2026 (A13 — Kevin: "continue finish all")

- **New task sources.** `importFollowUpSources` creates follow-ups from:
  - **Missed AI calls:** the caller hung up in under 15 s, or the call is flagged for a call back. Created as reason CALLBACK,
    source `missed_call`, due in 1 h.
  - **Failed or unknown Reception Copilot actions:** source `reception_copilot`. An unknown outcome gets priority `high`.
- Both sources look back 7 days and create one task per source event (`source_event_key`), so running them again adds nothing.
- The 5-minute follow-up job runs the import for every salon, and the "Bring in missed calls" button runs it on demand.
  Missed call and Reception Copilot are now filters on the list.
- **Recommended assignee.** The assignable staff member with the fewest open tasks (ties: assigned least recently). It is shown
  in the task with an "Assign to them" button; it is a suggestion only.
- **Notify the assignee.** When a task is given to someone else, an in-app alert (`ai_follow_up_assigned`) and an
  `assignee_notified` activity row are written. There is no per-person inbox in the POS, so the alert names the person. Nothing is
  sent outside the salon.
- **Hold expiry.** When a Waiting task's time passes, it goes back to In progress (the follow-up lifecycle allows waiting → in progress only) and gets a `hold_expired` activity row
  (`expireFollowUpHolds`, run by the 5-minute job).
- **Check history.** `GET …/health/history` lists every recorded Check Follow-Up System run.
- **Tests:**
  - `ai-follow-up-center.pgtest` (26)
  - `POSAIFollowUpsScreen.test` (7)
