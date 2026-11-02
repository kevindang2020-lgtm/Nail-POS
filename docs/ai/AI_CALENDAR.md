# AI Calendar — Complete Build Guide handoff (guide 25, Oct 31 2026)

Route `/tenant/ai/receptionist/calendar` (AI Center → Calendar). Migration `758_ai_calendar_center.sql` (local `aps` template only).
Status words: COMPLETED_AND_VERIFIED · IMPLEMENTED_NOT_VERIFIED · BLOCKED_EXTERNAL · FAILED · NOT_IMPLEMENTED.

## Repository audit (P0)
| Piece | Before | Now |
|---|---|---|
| Screen | `POSAICalendarScreen.tsx` (97 lines): `posBookingApi.dayGrid` + client-side counts | Rebuilt in place; reads `/pos/ai/calendar-center/*` |
| Backend | none (Booking's `GET /pos/booking/day-grid` reused) | `modules/ai/src/ai-center/ai-calendar-center.ts` + `.controller.ts` (read-only), wired in `ai-center.module.ts` |
| Canonical sources | `pos_tech_appointments`, `booking_holds`, `BookingService.dayGrid / technicianPage`, `voice_tool_executions`, `reception_copilot_action_ledger`, `technician_shifts`, `appointment_reminders_sent`, `audit_events` | unchanged — **no second appointment store** |
| Writes | none | still none from AI Calendar; a move = Reception Copilot `prepare → confirm → verify` → canonical BookingService |

## Root cause of the photographed "0 / 0 / 114 / 3" (from code)
* **Open Slots 114** = 3 technician columns × 38 start times: 15-minute starts in which Booking's **default 45-minute service** (+5-min buffer) fits inside **09:00–19:00**. Those hours are the engine's hard-coded defaults (saved salon hours are not mapped into the booking engine — Business Setup finding); the engine's `openSlotCount` also **counted times already past today** and **ignored live booking holds** (`existingForConflict` reads appointments only). Now: the card shows the hold-aware, past-aware number with its definition, and the reconciliation lists Booking's raw total and each difference.
* **Technicians On 3** = technician records with `available` (active), **not** people scheduled. Now: *Scheduled today* (active + a working window), with active roster, clocked-in (open `technician_shifts` punch, today) and free-now beside it.
* **AI-Created 0**: the old count was a substring heuristic on `source`. Now the canonical source `'ai'` (the DB's own enum), with tool-ledger lineage (`voice_tool_executions`) shown separately. A code-pending booking is a hold/session, never an appointment.
* **Appointments 0** on 2026-10-30 is consistent with canonical rows *if* none existed; the production rows themselves need staging access (BLOCKED_EXTERNAL).
* **Malformed `u2039` / `u2014`**: two causes — the frozen `catalog.en.ts` holds double-escaped values (`'\\u2039 Prev'`, `'Appointments \\u2014'`), and the JSX text `{a.startTime}–{a.endTime}` is never an escape in JSX. Fixed with a new `aical.*` namespace (real characters) — `catalog.en.ts` untouched (frozen).
* **Wrong "today" after 8 PM**: the day came from the browser in UTC (`toISOString`); now the branch's clock.

## Metric definitions (shown on screen)
| Counter | Definition |
|---|---|
| Appointments | unique appointments for the day + branch (and branch-less rows, as Booking shows them); cancelled / no-show listed separately, not counted |
| AI-Created | of those, canonical source `ai`; requested / pending verification / failed AI attempts never counted |
| Open Slots | bookable start times for Booking's default service (duration, buffer, grid from Booking settings) over technicians with working hours; minus appointments, blocked times, **live holds** and **past times today** — a grid estimate; Booking's raw total shown beside it |
| Technicians On | scheduled today (working window); active roster, clocked in, free now as context; Unknown is never shown as 0 |

## Features
| Guide item | Status | Evidence |
|---|---|---|
| Preserve shell, title, Prev/Today/Next, single-day picker, Open in POS Booking, four metrics, empty state | COMPLETED_AND_VERIFIED | E2E `aical` 1 |
| Day view, 12 technicians/page "X–Y of N", service-time order, AI badge, live / code-pending holds | COMPLETED_AND_VERIFIED | E2E 2, pgtest day view |
| Week / Month (salon-local, tap a day → Day), no stale-view flash | COMPLETED_AND_VERIFIED | E2E 2 (caught + fixed a stale week→month render) |
| List: server search (name, phone E.164 / punctuation, email, appointment ID, technician, service), status / source / AI-only, date basis (service / created / updated / cancelled / AI-created), presets + From/To month calendar, pages 10/20/50, newest-created default, scheduled / updated sorts | COMPLETED_AND_VERIFIED | pgtest T07–T20, E2E 3–4 |
| URL keeps date + view (refresh / back) — no PII in the URL | COMPLETED_AND_VERIFIED | E2E 7 |
| Overlay: 8 tabs (Overview, Customer, Services & Technicians, Booking History, AI Activity, Verification & Holds, Communications, Audit Trail), Close, Open in POS Booking / View Customer / View Technician Schedule; view audited; contact masked unless the role may export customers | COMPLETED_AND_VERIFIED | pgtest, E2E 5, 8 |
| Open in POS Booking carries the day (`?date=`); Booking reads it as its starting day only | COMPLETED_AND_VERIFIED (date) · NOT_IMPLEMENTED (appointment / technician focus inside the board) | `POSBookingScreen.tsx` initial `calDate` |
| Check Calendar System: 8 groups (Canonical Booking parity, Technician Schedule, Holds & OTP, AI provenance, Realtime, Metrics, Conflicts, Permission & audit), evidence + source + next step, recorded, 30 s rate limit | COMPLETED_AND_VERIFIED | pgtest, race, E2E 6 |
| Scheduling Assistant: verified openings, idle gaps (labelled suggestion), code-pending holds expiring (no code shown), staff conflicts → Review (no write) → Confirm via Copilot → verified | COMPLETED_AND_VERIFIED (harness; booking write = raw-SQL stand-in) | pgtest, E2E 7 |
| Realtime: `useRealtime(['booking','technicians'])` + 45 s safety refresh + "as of" + stale note | IMPLEMENTED_NOT_VERIFIED (live socket) | realtime check is honest WARNING: server can't see a browser's socket |
| 27″ layout, 44 px targets, no page-wide sideways scroll | COMPLETED_AND_VERIFIED (browser) · BLOCKED_EXTERNAL (physical ASUS) | E2E 8 at 1920×945, 1366×768, 1280×720, 1024×768 |

## Acceptance matrix (guide §18)
| T | Result | T | Result |
|---|---|---|---|
| T01 physical 27″ / Windows 125% | BLOCKED_EXTERNAL | T27 expired hold releases availability | COMPLETED_AND_VERIFIED (pgtest) |
| T02–T05 | COMPLETED_AND_VERIFIED (E2E) | T28 two requests can't double-book | COMPLETED_AND_VERIFIED (race: 4 moves → 1; 4/4 land with the constraint dropped) |
| T06 unicode | COMPLETED_AND_VERIFIED | T29 phone re-verification | IMPLEMENTED_NOT_VERIFIED here (guide 9/10 suites) |
| T07–T13 search / filters / tenant | COMPLETED_AND_VERIFIED | T30 reminders on cancel/reschedule | COMPLETED_AND_VERIFIED in guide 14 (reminder-center 19/19 re-run) |
| T14–T20 dates / paging | COMPLETED_AND_VERIFIED | T31–T35 counters | COMPLETED_AND_VERIFIED (multi-tech: one technician per appointment row in this schema — counted once by id) |
| T21–T26 booking + OTP path | IMPLEMENTED_NOT_VERIFIED here — owned by guides 10/21/22 (booking-verification-center 14/14 re-run); real Twilio Verify BLOCKED_EXTERNAL | T36 same appointment in AI Calendar and POS Booking | COMPLETED_AND_VERIFIED (health parity check; harness) |
| T37 AI flag from source | COMPLETED_AND_VERIFIED | T38 realtime without duplicates | IMPLEMENTED_NOT_VERIFIED (shared hook) |
| T39 stale warning + fallback | COMPLETED_AND_VERIFIED (stale note + 45 s refresh) | T40–T46 overlays / security | COMPLETED_AND_VERIFIED (T46: no OTP or secret is read or returned) |
| T47 lint / typecheck / component tests | IMPLEMENTED_NOT_VERIFIED (CI) | T48 API + migration tests | COMPLETED_AND_VERIFIED (pgtest 18/18, race 2/2, migration applied twice) |
| T49 staging screenshot | BLOCKED_EXTERNAL | T50 cross-browser | NOT_RUN (Chromium only) |
| T51 physical ASUS | BLOCKED_EXTERNAL (not tested) | T52 rollout / reconciliation report | this file |

## Tests (Oct 31 2026)
* `modules/ai/src/ai-center/ai-calendar-center.pgtest.vitest.spec.ts` — 18/18 (stand-in; BookingService's two reads stubbed from the same rows with Booking's own engine functions).
* `ai-calendar.postgres-race.vitest.spec.ts` — 2/2 on real Postgres, 4 sessions. Mutation: constraint dropped → 4 of 4 moves land; advisory lock removed → 4 runs recorded. Both restored.
* Browser `aical` (with `rcc`): 17/17 (Chromium, EN/VI, Owner + Front Desk, 4 sizes).
* Combined run (25 sections, `seg … rcc,aical`): 253/254. The one failure was this guide's own assistant step assuming WHICH of the two overlapping appointments would be proposed (it is whichever has the larger random id); the step now asserts exactly one moves and the other keeps its time, and `rcc,aical` re-ran 17/17. `comms` 12/12.
* Regression: reception-copilot-center 13/13, receptionist-center 16/16, ai-calls-center 14/14, front-desk-center 16/16, business-setup-center 21/21, booking-verification-center 14/14, reminder-center 19/19.
* `POSAIBusinessAndCalendar.test.tsx` (calendar half rewritten) — IMPLEMENTED_NOT_VERIFIED (CI).

## Decisions
* AI package for the routes: `ai_phone_call_assistant` (the AI Receptionist package; the nav's `ai_reception` code has no backend check).
* Full contact in the overlay only for roles holding `customers.export` (owners / managers) — the policy has no separate "view contact" permission.
* Unapproved technician overlaps can't be created any more (`pos_tech_appointments_no_overlap`, from 2026-07-30); the conflicts check still reports legacy rows.

## Readiness
CODE_READY. SANDBOX_VERIFIED: no (needs staging with real Booking + Twilio Verify). PRODUCTION_READY: no.
Rollout: deploy 758 (additive; rollback in the file header) → enable the AI Calendar nav per salon → compare Check Calendar System parity on staging for a week.

## Handoffs
* Guide 26 AI Follow-Ups / 27 AI Center: the calendar summary (`/pos/ai/calendar-center/summary`) and health run are reusable read models.
* Open owner decisions: (1) map saved salon hours into the booking engine (affects Open Slots), (2) Front Desk full contact in the overlay?, (3) deep-link focus on an appointment inside POS Booking.
