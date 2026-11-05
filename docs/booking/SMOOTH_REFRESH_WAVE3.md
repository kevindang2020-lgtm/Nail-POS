# Smooth Refresh, Realtime Sync & Booking Concurrency — Wave 3 re-verification (Oct 13 2026)

Kevin's instruction: *"keep your 15-second POS sync and 20-second server reconciliation, but I would not depend on either one
to prevent double booking. Booking conflicts must be blocked immediately by the backend/database at the exact moment a booking
is created or moved."*

This is the spec §123 report for the Wave 3 pass. The Sep 30 build (`SMOOTH_REFRESH_REPORT.md`, `SMOOTH_REFRESH_WIRING_CHECK.md`)
was written on tree `cd96331`; waves 1–2 (Oct 12–13) moved the booking engines into the module tree and merged another chat's
booking-concurrency work. Every one of the 123 sections was re-checked on the current tree by reading the code or running the
named test; the per-section ledger is in the wave's scratch ledger (`ledger-SR.md`). Timings are unchanged: **POS safety sync
15 s ± 2 s** (`packages/realtime-client/src/sync-policy.ts`, `SYNC_POLICY.operationalMs = 15_000`), **server reconciliation
20 s** (`apps/api/src/observability/sync-reconciliation.ts`, `RECONCILE_EVERY_MS = 20_000`).

## 1. Every path that puts a technician on a slot, and what blocks it

| Path | Writer | Guard (all inside ONE transaction) |
|---|---|---|
| POS Booking board — create, drag/reschedule, technician change, add-on/duration change | `modules/booking/src/booking/booking.kysely.repository.ts` | `pg_advisory_xact_lock(tenant\|technician\|date)` → re-read committed rows → `pbDetectTechnicianConflict` (half-open, buffer) → live-hold re-read under the branch-day lock → `version` check (`expectedVersion` → 409 VERSION_CONFLICT) → write + outbox event. Migration 426/482's gist EXCLUDE is the last line (23P01 → 409 APPOINTMENT_CONFLICT, never a 500). |
| AI receptionist (voice write), Reception Copilot, AI scheduling optimizer, public booking link | `BookingService.create / reschedule` | the same engine (policy §11, breaks/hours §71–72, holds §73, first-available retry) |
| Customer app, voice-booking gateway | `modules/booking/src/customer-booking/customer-booking.kysely.repository.ts` `insertBookingAtomic / rescheduleAtomic` | lock → re-read → **live-hold re-read (new this wave)** → write; 23P01 → `{ ok: false }` → 409. **Working hours / breaks / blocked time (new this wave)** |
| Technician Appointments screen — create, update(duration), reschedule, assign | `modules/appointments/src/tech-appointments/tech-appointments.kysely.repository.ts` | `writeAppointmentSlot` (same lock key, re-read, version, 23P01 → `AppointmentSlotConflict`) |
| Live technician schedule — open-slot booking | `modules/queue/src/live-technician-schedule/live-technician-schedule.kysely.repository.ts` | `writeAppointmentSlot` |
| Check-in, serving, service done, queue cascade, tech-app start/finish, customer cancel/check-in, phone replace | status / phone columns only | never change technician, date or time — not slot writers |

Overbooking is only ever an explicit, reasoned, audited act written ON the row (`overbook_ok`, `overbook_reason`,
`overbook_by_user_id`, migration 482); only such rows are exempt from the EXCLUDE guard. Policy default: BLOCK.

## 2. What this wave found and fixed

1. **Customer app ignored live holds inside its transaction** (§13/§73). The staff engine re-read holds under the branch-day
   lock since Round 3 H2; the customer app's `insertBookingAtomic` / `rescheduleAtomic` did not, so a slot the AI receptionist
   was holding for a caller could be booked from the app. Both now call the ONE shared `lockedForeignHold`
   (`modules/booking/src/customer-booking/booking-hold-locked-check.ts`) — the same function the staff engine uses.
   Real-PG: insert vs hold fired together on 6 slots → exactly one winner each time; another session's hold refuses the app's
   insert and reschedule; the app's OWN verification hold never blocks its own booking.
2. **Regression caught before it shipped:** the first cut of (1) did not forward the booking session from the phone-verification
   admission to the atomic insert, so a customer's own hold would have refused the customer. `CustomerBookingService.book()`
   now passes `admission.hold.bookingSessionId`; the verification-gate suite asserts it (17/17).
3. **§71/§72 for the customer app and the AI receptionist riding on it.** `availability.ts` said it plainly: *"Technician shifts
   + blocked-times are NOT yet enforced by the booking path."* A customer could book Sarah through her lunch or after her shift.
   `CustomerBookingDataPort.technicianWindows` now answers the technician's bookable windows for the day — store hours ∩ weekly
   schedule − breaks/lunch − blocked time, computed by the staff engine's own `pbTechDayWindows` from the staff repository's
   own reads (one schedule reader, no copy). `book()` and `reschedule()` refuse a visit outside them (a customer never gets
   an override); `availability()` never offers such a slot. Tests: `customer-booking-working-hours.vitest.spec.ts` (6) and a
   real-PG windows test (schedule 09–17, lunch 13:00–13:30, blocked 15–16 → three windows; no schedule row → store hours).
4. **Technician Appointments screen was outside the sync layer** (§17/§20/§94). It had no `useRealtime` (another device's
   booking reached it only on a manual reload) and a failed background refresh replaced the board with the error. It now
   refetches on `booking` / `tech-appointments` / `technicians` events and the 15 s safety sync, keeps its rows and open
   drawer on a failed refresh, and shows the failure as a note (`POSTechAppointmentsScreen.test.tsx`).
5. **New real-PG race suite for MOVES** — `modules/booking/src/booking/booking-move-paths.postgres-race.vitest.spec.ts` (6/6):
   §69 duration change vs create (POS board and Tech Appointments, 3 rounds); technician change (assign) vs create on the new
   technician; customer-app reschedule vs POS create vs Tech-Appointments reschedule; POS reschedule vs customer-app create;
   §104 as moves — ten back-to-back visits lengthened at once → one winner, no overlapping rows survive. Every loser is a
   typed conflict; losers stay exactly where they were (§75).

Mutation checks (scratch `mut-SR.md`): removing the §69 in-transaction re-check alone still passes (the EXCLUDE constraint
catches it — defense in depth by design); removing it AND the 23P01 mapping fails the suite (an untyped error escapes).

## 3. Verification on this tree

| Check | Result |
|---|---|
| modules/booking unit + PGlite suite | 662 pass (one prior-pass regression in `rescheduleAtomic` fixed: the hold guard is read inside the transaction) |
| Real-PG race lane, booking | 10 files / 39 tests pass (booking-concurrency 7, cross-surface 3, first-available 2, hold-vs-booking 2, **move-paths 6**, **customer holds+schedule 5**, …) |
| Real-PG race lane, others | queue 26, customers 5, gift-cards 2, inventory 2, deals 8, ai 14, super-admin 9, workforce 16, safety 3, marketing 4 pass; reconciliation §73/§100/§102/§103 4/4 |
| packages/realtime-client | 28 pass (15 s ± 2 s, hidden 60 s, single-flight, backoff) |
| apps/pos-web sync + operational screens | 189 + 3 pass (useRealtime, resilience, failure modes, Booking preservation, Queue, Tech Queue, Serving, Service Done, Check-In, Checkout, Customers, Tech Appointments) |
| tsc modules/booking | clean |

Not green in this lane, and not from this work: `modules/checkout` checkout-concurrency races and four `apps/api` race files
fail to load against the Wave 3 scratch database because the Tap-to-Pay work in flight adds `payments.payment_surface` and
exports `mobile-checkout/mobile-attempt-recovery` that do not exist yet in the tree/database; they pass once that work lands
with its migration. The identity `last-owner` race test was not re-runnable on a reused database (append-only audit ledger);
its count is now scoped to the run (test-only change).

## 4. Still needs Kevin's environment (unchanged from Sep 30)
Staging measurements for §3 (event latency), §57 (production plans), §97–§99 (10,000-tenant fairness), §101 (sync durations,
payload sizes); the real-browser `npm run perf:booking` / `perf:realtime` runs on the salon's own devices.
