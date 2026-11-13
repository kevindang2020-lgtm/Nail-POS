# Merge Checklist — Booking Schedule Board → AIPowerSalon POS

Follow in order (spec §41). Do not tick a box until it has been checked against the real tree.

## A. Prepare

- [ ] 1. Create a branch (e.g. `feature/booking-schedule-board`) from the current canonical tree.
- [ ] 2. Copy this package into the monorepo, e.g. `packages/booking-schedule-board/`, and add it to the npm workspaces. Do **not** copy `node_modules/`, `dist/` or `screenshots/`.
- [ ] 3. Find the current schedule-board boundary in `apps/pos-web` (the Booking screen). Record the exact JSX region from **Find an opening** to the **legend / Block time** row.
- [ ] 4. Confirm **Booking Assistant · New Appointment** and everything below it stays untouched.

## B. Wire the production adapter

- [ ] 5. Audit the existing booking/availability/appointment routes first; reuse them, don't duplicate them. Only add a thin board controller where no route exists.
- [ ] 6. Fill `EndpointMap` with real paths.
- [ ] 7. Implement `ProductionMappers` for each host DTO. Check field names against the **wire payload**, not client types (e.g. technician `fullName` → `displayName`). Add a fixture-from-wire test per mapper.
- [ ] 8. Map host error codes into `HOST_ERROR_CODE_MAP`, including the database overlap violation → `APPOINTMENT_CONFLICT`.
- [ ] 9. Make sure create/move/walk-in/blocked-time endpoints honour `Idempotency-Key`, and move/cancel honour `expectedVersion`.
- [ ] 10. Confirm the service-eligibility source is the same technician↔service relation used by Add Walk-In, New Booking, Tech Queue, Fair Turn, online booking and AI phone booking.
- [ ] 11. Map the host's "protected appointment" concept (requested technician, VIP, deposit, etc.) to `Appointment.protected` and the buffer, if any.
- [ ] 12. Route `technicianId: 'any'` walk-ins to the existing Fair Turn service (eligible set only).

## C. Wire the host

- [ ] 13. Mount `<BookingScheduleBoard>` in the replacement region only. Do not change the sidebar, top bar or Super Admin.
- [ ] 14. `onOpenBookingAssistant` / `onOpenNewBooking` → prefill the existing Booking Assistant (date, technician, start, duration, service).
- [ ] 15. Host Add Walk-In and New Booking buttons keep working; after a successful create, confirm the board updates by realtime event (no page reload).
- [ ] 16. Wrap the existing SSE client as `RealtimeClient`. Emit the event types in README-INTEGRATION §5 with a monotonic per-branch `serverVersion`. Keep the existing safety-sync fallback (`schedule.resync`).
- [ ] 17. Resolve `BoardPermissions` from the host RBAC; confirm the server enforces the same rules.
- [ ] 18. Confirm audit entries for create, move, reassign, cancel, blocked time and price override go through the existing audit service.
- [ ] 19. Persist `onStateChange` state (route state or session storage) and pass it back as `initialState` after returning from a workflow.
- [ ] 20. Apply POS design tokens by overriding `--bsb-*` variables if the screenshot palette is not wanted.
- [ ] 21. **Remove the mock from production:** production code imports only from `src/index.ts`; `src/testing.ts`, `fixtures/` and `MockBookingDataAdapter` appear only in tests. Check the built bundle contains no fixture names.

## D. Verify (all must pass before the old board is removed)

- [ ] 22. Host gates green, including `check:dialogs`, `check:no-print`, `check:money`, `check:tenant`, `check:boot`.
- [ ] 23. Package suite: `npm run check:all` (47 tests) and `node scripts/e2e-browser.cjs`.
- [ ] 24. Full Booking regression tests.
- [ ] 25. Journey regression: Booking → Appointment → Check-In → Visit → Customer Queue → Technician Assignment → Serving → Service Done → Checkout → Payment.
- [ ] 26. Acceptance matrix §39 against the real API (see table below).
- [ ] 27. Tenant isolation: a user of salon A cannot see or change salon B's appointments, technicians, customers, schedules, services or notes, even with forged ids in the request.
- [ ] 28. Branch isolation: same, across branches of one salon.
- [ ] 29. Two real browsers booking the same slot → exactly one success, one `APPOINTMENT_CONFLICT`.
- [ ] 30. 1920×1080 at 100% zoom inside the real POS shell: no page scroll, 12 headers unclipped (also check 1366×768 and 1536×864 floors).
- [ ] 31. Keep the old board recoverable (feature flag or the previous component left in place) until all of the above pass; only then remove it.

## Acceptance matrix (spec §39)

| # | Scenario | Standalone proof | Real-API proof |
|---|---|---|---|
| 1 | Book 45 min into a 45-min opening | adapter.test `#2/#1` | ☐ |
| 2 | Book 60 min into a 45-min opening → rejected | adapter.test `#2/#1` | ☐ |
| 3 | Two stations, same slot → one `APPOINTMENT_CONFLICT` | adapter.test `#3` (sabotage-proven), board.test `#3` | ☐ |
| 4 | Drag A → B validates B first | e2e-browser (invalid target never reaches backend), adapter.test `#10` | ☐ |
| 5 | Runs into protected appointment → rejected | domain.test, adapter.test `#5` | ☐ |
| 6 | Unqualified technician not offered / rejected | adapter.test `#6`, board.test `#6` | ☐ |
| 7 | 60-min block → opening disappears | adapter.test `#7`, board.test `#7` | ☐ |
| 8 | Host Add Walk-In → board / queues / Fair Turn reconcile | adapter.test (Fair Turn over eligible set; walk-in event) — **host queues not testable standalone** | ☐ |
| 9 | Booking on station A → station B updates | board.test `#9` | ☐ |
| 10 | Move → source + destination recomputed | adapter.test `#10`, board.test `#4/#10`, e2e-browser | ☐ |
| 11 | Return from workflow → state preserved | board.test `#11` | ☐ |
| 12 | 1920×1080 usable without page scroll | e2e-browser | ☐ |
