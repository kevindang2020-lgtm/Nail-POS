# Merge Checklist — Booking Schedule Board → AIPowerSalon POS

Follow in order (spec §41). A box is ticked only when it was checked against the real tree in the merge session
(Nov 13 2026, branch `extras-agent1`); the evidence is named next to it. Unticked = not proven yet.

## A. Prepare

- [x] 1. Branch: `extras-agent1` (worktree), from `967ef105`.
- [x] 2. Package at `packages/booking-schedule-board/` (npm workspace `packages/*`, lockfile entries added); no `node_modules/`, `dist/`, `screenshots/` or demo build.
- [x] 3. Boundary: `POSBookingScreen` — the classic "Toolbar 2" (Find an opening … pager), the Best Matches panel and `<BookingCalendar>` are the replaced region; the new board renders there through `screens/booking/BookingBoardRegion.tsx`.
- [x] 4. Booking Assistant · New Appointment and everything below are untouched (`POSBookingScreen.board.test.tsx` "is the default schedule region…" asserts the assistant + KPI sections are still rendered).

## B. Wire the production adapter

- [x] 5. Existing routes reused; no new route was added (see README-INTEGRATION §4).
- [x] 6. Real paths in `ProductionBookingDataAdapter` (`/pos/booking/technicians`, `/day-grid`, `/availability`, `/openings`, `/appointments`, `/reschedule`, `/cancel`, `/blocked-times`, `/pos/check-in/walk-in`).
- [x] 7. Mappers in `src/adapters/posBookingWire.ts`, tested on wire payloads recorded from the real controller (`src/tests/wire.test.ts`; recorder + drift check `modules/booking/src/booking/booking-board-wire.pgtest.vitest.spec.ts`).
- [x] 8. Host codes → domain errors (`POS_BOOKING_ERROR_CODES`), incl. the overlap refusals → `APPOINTMENT_CONFLICT`.
- [x] 9. Idempotency-Key on create / move / walk-in / blocked time; `expectedVersion` on move (cancel has no version on the server). Fixed on the way: the repository never selected `version` (every read was 1) — `booking-board-wire.pgtest` "#4/#10" and the recorded `rescheduled.json` (version 2) prove it now.
- [x] 10. Eligibility source = the server's exact-service authority for every board path (availability / openings / create / reschedule); the board pre-checks nothing (`serviceIds: null`).
- [ ] 11. Host "protected appointment" concept: none exists — the server refuses ANY overlap (EXCLUDE guard), so `Appointment.protected` stays false. Revisit only if Kevin adds VIP / deposit protection.
- [x] 12. `technicianId: 'any'` walk-ins → `POST /pos/check-in/walk-in` (the existing queue / Fair Turn intake). The page's Add Walk-In button still opens the existing walk-in workflow.

## C. Wire the host

- [x] 13. Mounted in the replacement region only; top bar, sidebar, Super Admin untouched (no file under `apps/pos-web/src/shell/` changed).
- [x] 14. `onOpenBookingAssistant` / `onOpenNewBooking` → prefill the existing Booking Assistant (technician, date, time, service) — `POSBookingScreen.board.test.tsx` "a tap on an open time prefills…".
- [x] 15. After a host create / walk-in the page's realtime + its own refetch call `bridge.resync()` → the board reloads its page (test "a booking realtime event reloads the visible page").
- [x] 16. `HostScheduleBridge` wraps the page's realtime (SSE + 15 s change feed, scoped by `bookingRelevance` with the board's visible technicians); monotonic versions from a shared `MonotonicClock` (`wire.test.ts` HostScheduleBridge).
- [x] 17. `BoardPermissions` from `useCan()` (`pos.booking.create / reschedule / cancel / edit / view`); the server enforces each route's `RequirePermission`.
- [ ] 18. Audit: create / move / reassign / cancel / blocked time are audited by the existing BookingService (unchanged); not re-tested in this session.
- [x] 19. Board state in this tab's session storage (`aps.booking.board.state`) + the page's date and Day/Week restored after a workflow (test "board state survives leaving and coming back").
- [x] 20. Picture palette kept (addendum §04); accent / ink / font mapped to POS tokens in `screens/booking/bookingBoard.css` (scoped `.pos-booking-board`).
- [x] 21. Production imports only `src/index.ts`; the mock and fixtures are reachable only from `src/testing.ts` / tests.

## D. Verify (all must pass before the classic board is removed)

- [ ] 22. Host gates: run in this session — `check:no-print`, `check:dialogs`, `check:money`, `check:silent-catch`, `check:dead-client`, `check:error-text`, architecture tests, i18n / pos-i18n / vi-glossary / ns-collisions, pos module registry, frontend builds, app types. The full gate battery is the coordinator's.
- [x] 23. Package suite: 63 / 63 (`npx vitest run`), strict typecheck, package no-print gate. (The Playwright script was not carried over.)
- [ ] 24. Full Booking regression: the Booking screen test files ran green (120 tests in 12 files, incl. the classic board’s), not the whole POS suite.
- [ ] 25. Journey regression (Check-In → Queue → Serving → Service Done → Checkout): not run in this session.
- [x] 26. Acceptance §39 against the real API — see the table below.
- [x] 27. Tenant isolation: another salon sees no technician / appointment and cannot move one (`booking-board-wire.pgtest`).
- [ ] 28. Branch isolation across branches of one salon: relies on the existing repository scoping; not re-tested here.
- [ ] 29. Two REAL browsers / parallel Postgres connections: the PGlite proof serialises; `booking-concurrency.postgres-race` needs `PG_RACE_URL`.
- [ ] 30. 1920×1080 at 100% zoom inside the real shell / SUNMI 27": no browser run in this session (jsdom only).
- [x] 31. Classic board recoverable: per-person "Classic board" switch (default = new board), classic calendar tests still green.

## Acceptance matrix (spec §39)

| # | Scenario | Real-API proof (this session) | Board / host proof |
|---|---|---|---|
| 1 | Book 45 min into a 45-min opening | PASS — `booking-board-wire.pgtest` #1 (opening gone from the day grid) | package adapter.test |
| 2 | 60 min into a 45-min opening → rejected | PASS — pgtest #2 (409, nothing written) | package adapter.test |
| 3 | Two stations, same slot → one conflict | PASS (serialised PGlite) — pgtest #3 | package board.test #3 |
| 4 | Drag A → B validates B first | PASS — pgtest #4/#10 (unqualified B refused, server-side) | package board.test #4 |
| 5 | Runs into the next appointment → rejected | PASS — pgtest #5 | package domain/adapter tests |
| 6 | Unqualified technician not offered / rejected | PASS — pgtest #6 (no slots, not in openings, create refused with the code) | package board.test #6 |
| 7 | 60-min block → opening disappears | PASS — pgtest #7 | package board.test #7 |
| 8 | Host Add Walk-In → board / queues / Fair Turn reconcile | NOT_TESTED (queue + Fair Turn in the real app) | board reload on a booking event: POS board test |
| 9 | Station A books → station B updates | PASS (simulated realtime event → page reload) | POS board test; live SSE NOT_TESTED |
| 10 | Move → source + destination recomputed | PASS — pgtest #4/#10 | package board.test #10 |
| 11 | Return from workflow → state preserved | — | PASS — POS board test (page 2 + date restored) |
| 12 | 1920×1080 usable without page scroll | — | NOT_TESTED (no browser in this session) |
