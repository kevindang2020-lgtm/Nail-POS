# Booking Schedule Board — Integration Guide

Standalone, integration-ready replacement for the **schedule-board region** of the AIPowerSalon POS Booking page
(spec: *AI PowerSalon Standalone Booking Schedule Board — Claude Build Specification + Merge Contract*).

The board covers everything from **Find an opening** down to the **legend / Block time** row.
It does **not** contain, replace or depend on **Booking Assistant · New Appointment** — the host keeps that section
and everything below it.

---

## 1. What is in this package

| Path | What it is |
|---|---|
| `src/index.ts` | **Production entry point.** Board component, adapter contract, production adapter, domain types/engine, realtime contract. |
| `src/testing.ts` | **Dev/test-only entry point.** `MockBookingDataAdapter` + fixtures. Never import from production code. |
| `src/components/` | `BookingScheduleBoard` (root), `BookingToolbar`, `OpeningToolbar`, `TechnicianPager`, `TechnicianHeader`, `DailyAvailabilityStrip`, `ScheduleGrid`, `AppointmentCard`, `OpenSlotCard`, `BlockedTimeCard`, `BookingLegend`, `BlockTimeAction`, `FindOpeningPanel`, `BestMatchesPanel`, `TechnicianDayPanel`, `AppointmentPanel`, `ViewAllPopover`, `WeekView` |
| `src/domain/` | Pure logic: `scheduleTypes`, `time` (timezone-correct), `availability`, `eligibility`, `openings` (Find an Opening + Best Matches), `paging`, `bookingErrors`, `technicianColor` (stable identity accent) |
| `src/i18n/boardText.tsx` | Every board string (`BOARD_TEXT_EN`), `translate` / `formatMoney` provider |
| `src/adapters/` | `BookingDataAdapter` (interface), `MockBookingDataAdapter` (in-memory, tests only), `ProductionBookingDataAdapter` + `HostScheduleBridge` (the real POS API / realtime), `posBookingWire` (wire → board mapping) |
| `src/state/` | `boardState` (UI reducer, persistence), `scheduleStore` (per-technician slices, realtime reconciliation) |
| `src/realtime/events.ts` | Typed schedule events, `RealtimeClient` interface, affected-technician routing |
| `src/hooks/useScheduleRange.ts` | One range request per branch/date + subscription + silent resync |
| `src/styles/board.css` | All styles, scoped under `.bsb-root` with `--bsb-*` variables |
| `scripts/check-no-print.mjs` | Same rule as the host's `check:no-print` gate |
| `src/tests/fixtures/wire/` | Payloads recorded from the real booking API (see §4) |

Stack matches `apps/pos-web`: React 18, TypeScript 5 (strict), Vitest + Testing Library. No other runtime dependencies.
In the monorepo the demo host, its Vite dev server and the Playwright script were not carried over (build output only);
the POS resolves the package from source (vite / vitest alias + tsconfig path, like `@aipowersalon/ui`).

## 2. Running it in the monorepo

```bash
cd packages/booking-schedule-board
npx vitest run              # the package suite (jsdom)
npx tsc --noEmit -p .       # strict typecheck
node scripts/check-no-print.mjs src   # the package's no-print gate (the host's check:no-print also scans packages/)
```

## 3. Mounting the board — as merged into the POS (Nov 13 2026)

The POS mounts the board in `apps/pos-web/src/screens/booking/BookingBoardRegion.tsx`, rendered by `POSBookingScreen` in
the schedule region (Find an opening → legend / Block time). The page keeps its header, KPI cards, its own Day / Week /
date / filter toolbar (`showPrimaryToolbar={false}`), Booking Assistant · New Appointment and everything below.

```tsx
<BookingScheduleBoard
  tenantId={principal.tenantId} branchId={principal.branchId} userId={principal.userId}   // echo only — the server scopes
  timezone={state.dateRange.timezone} selectedDate={pageDate}          // the page's date; the board follows it
  permissions={{ canBook: can('pos.booking.create'), canMove: can('pos.booking.reschedule'), … }}   // UX gating only
  adapter={new ProductionBookingDataAdapter({ http, realtime: bridge, clock, timezone, loadServices, filters })}
  realtimeClient={bridge}                                              // HostScheduleBridge — the page's realtime pushes into it
  showPrimaryToolbar={false} fitDay={pageFitDay}
  translate={(k, v) => tx('bsb.' + k, v)} formatMoney={fmtMoney}       // POS `bsb` namespace, EN + VI
  initialState={sessionBoardState} onStateChange={(s) => writeSession(BOARD_STATE_KEY, s)}   // spec §26
  focusTechnician={jump}                                               // the page's "Find technician" box (#200 → page 17)
  onOpenBookingAssistant={prefillAssistant} onOpenNewBooking={prefillAssistant}            // PREFILL, never a second form
  onOpenAppointment={(a) => openIPad(appointmentRequest(adapter.rows.get(a.id)))}
  onVisibleChange={(v) => (boardView.current = v)}                     // realtime relevance: off-page changes skip the grid
/>
```

The previous calendar stays recoverable: a per-person **Classic board** switch in the page toolbar (remembered on the
device, `screens/booking/boardMode.ts`); the new board is the default.

### Outbound payload (`BookingContext`)

```ts
{ tenantId, branchId, date, technicianId, startAt /* ISO with offset */, availableDurationMinutes, serviceId?, appointmentId? }
```

`availableDurationMinutes` is what is free **from that cell** up to the next commitment, not the size of the whole gap.
The Booking Assistant still lets the server decide the final placement (availability, conflicts, SMS verification).

### Permissions

`BoardPermissions` hides/disables controls only. The server enforces the same rules on every route (`RequirePermission`).

| Flag | POS permission | Gates |
|---|---|---|
| `canBook` | `pos.booking.create` | `+ Book` cells, View All picks |
| `canMove` / `canReassign` | `pos.booking.reschedule` | Drag; Move in the appointment sheet |
| `canCancel` | `pos.booking.cancel` | Cancel in the appointment sheet (the server requires a reason) |
| `canBlockTime` | `pos.booking.edit` | Block time (legend + column menu) |
| `canViewTechnicianDay` | `pos.booking.view` | View day |
| `canOverridePrice` | — (false) | The board never edits a price; the Booking Assistant keeps the authorised override |

## 4. Adapter — the EXISTING POS booking API

`ProductionBookingDataAdapter` (`pagesOnServer = true`) holds no rule and no data of its own:

| Board call | Route(s) | Notes |
|---|---|---|
| `getScheduleRange` | `GET /pos/booking/technicians?date&page&pageSize&working` + `GET /pos/booking/day-grid?date&technicianIds=<the page>&status&source&serviceCategory&search` | ONE page of technicians (12 → 200 = 17 pages) and the day grid of those columns only; the board draws the server's `openRanges`. Two requests per page, never one per column. |
| `getAvailability` / `getTechnicianDay` | `GET /pos/booking/day-grid?technicianIds=…` | same open ranges |
| `findOpenings` | `GET /pos/booking/availability?date&serviceIds&technicianId` | bookable starts after hours, schedule, breaks, blocked time, bookings + buffer, holds and EXACT service eligibility; runs of starts become gaps |
| `getBestMatches` | `GET /pos/booking/openings?date&serviceIds` | eligibility first, then the server's ranking (never re-ranked) |
| `createAppointment` | `POST /pos/booking/appointments` (Idempotency-Key) | `technicianId: 'any'` → the engine's first-available rule |
| `moveAppointment` | `POST /pos/booking/appointments/:id/reschedule` (Idempotency-Key, `expectedVersion`) | server re-checks skill, windows, overlap (locked), holds |
| `cancelAppointment` | `POST /pos/booking/appointments/:id/cancel` | reason required by the server |
| `createWalkIn` | `POST /pos/check-in/walk-in` (Idempotency-Key) | `'any'` → queue / Fair Turn over the eligible set |
| `createBlockedTime` | `POST /pos/booking/blocked-times` | audited; over an appointment → `APPOINTMENT_CONFLICT` |
| `locateTechnician` | `GET /pos/booking/technicians?locate=<id>` | jump-to-technician |
| `getServices` | injected (`loadServices`) | the catalog the page already loaded from `GET /pos/booking/state` |

Mapping lives in `src/adapters/posBookingWire.ts` (`Wire…` types = only the fields read). The JSON in
`src/tests/fixtures/wire/` was recorded from the real `BookingController` on PGlite by
`modules/booking/src/booking/booking-board-wire.pgtest.vitest.spec.ts`, which fails when the server's wire shape drifts
(regenerate: `UPDATE_BOARD_WIRE_FIXTURES=1`). Refusals: `POS_BOOKING_ERROR_CODES` (`SCHEDULE_CHANGED_ELSEWHERE`,
`TECHNICIAN_DOUBLE_BOOKED`, `OVERBOOK_CONFIRMATION_REQUIRED`, `WINDOW_OVERLAPS_APPOINTMENT`, … → `APPOINTMENT_CONFLICT`;
`VERSION_CONFLICT` → `SCHEDULE_CHANGED`; `TECHNICIAN_NOT_SKILLED_FOR_SERVICES` → `TECHNICIAN_SERVICE_INELIGIBLE`). The
database's EXCLUDE refusal (23P01) only ever reaches the browser as one of those 409 codes.

Eligibility is never re-derived in the browser: production technicians carry `serviceIds: null`, so the board makes no
local skill verdict on a drag and the server decides (a refusal rolls the card back).

## 5. Realtime contract (spec §25)

The board consumes `ScheduleEventEnvelope { tenantId, branchId, date, serverVersion, at, event }`. Event types:
`appointment.created|moved|cancelled|reassigned|checked_in`, `walkin.created`, `service.started|completed`,
`blocked_time.created|changed|removed`, `technician.schedule_changed`, `schedule.resync`.

Reconciliation (`state/scheduleStore.ts`):

- Only the affected technicians' slices are rebuilt (`affectedTechnicians`), with a `revision` counter, so other columns do not re-render.
- In the POS the version is a client-side `MonotonicClock` shared by the adapter (snapshot) and `HostScheduleBridge`
  (events): the page's realtime (SSE + 15 s change feed, scoped by `bookingRelevance`) calls `bridge.resync(date)` and the
  board reloads ONLY its visible page; a change for an off-page technician never reloads it.
- `serverVersion` must be **monotonic per branch**. A gap (missed event) or `schedule.resync` triggers one silent range
  reload; this is how the host's existing "silent safety synchronization" plugs in.
- Events whose version is ≤ the current version are ignored, so the echo of the board's own mutation is harmless.

## 6. Domain errors (spec §35)

`APPOINTMENT_CONFLICT`, `TECHNICIAN_UNAVAILABLE`, `TECHNICIAN_SERVICE_INELIGIBLE`, `SCHEDULE_CHANGED`,
`PERMISSION_DENIED`, `INVALID_DURATION`, `BLOCKED_TIME_CONFLICT`, plus `APPOINTMENT_PROTECTION`, `NOT_FOUND`,
`VALIDATION_FAILED`, `NETWORK_ERROR`, `UNKNOWN`. Each has a human-readable default message; conflicts, protection,
stale-schedule and unknown errors trigger a silent reload after the message.

## 7. Deliberate decisions and deviations

| Item | Decision |
|---|---|
| **Print Schedule (spec §3, §30)** | **Not built** — superseded by the booking200 addendum (§10, B-20) and the owner's no-print rule. AIPowerSalon has a permanent no-print rule for schedules, queues and service tickets (enforced by the host's `check:no-print` gate, re-confirmed Oct 26 2026). The spec asks for it; building it would fail the host's gate. `BookingLegend` keeps an `actions` slot, and `scripts/check-no-print.mjs` fails the package if a print control is added. |
| Technicians off for the day | Not paged and not counted, so "Working technicians (N)" and "Technicians x–y of N" always agree (spec §19). They are listed as "Off today" in the technician filter. |
| Blocking over an existing appointment | Refused with `APPOINTMENT_CONFLICT` (move or cancel first) rather than silently overlapping. Change in `createBlockedTime` if the host allows overrides. |
| Native dialogs | None. All prompts and confirmations are inline panels (host `check:dialogs` rule). |
| Fonts | The board uses the host font stack via `--bsb-font`; the package loads no external fonts. |
| Colours | Status palette from booking200 addendum §04 (confirmed #168AF5/#E7F1FF, arrived #8374EE, in service #A747EF, walk-in #F96B21, open mint #DFFCF3 + dashed #13BE98, break #F0F3F7). The POS maps accent / ink / font to its tokens (`apps/pos-web/src/screens/booking/bookingBoard.css`, scoped to `.pos-booking-board`). |
| Technician identity | `technicianAccent(tenantId, technicianId)` — FNV-1a of `tenant:technician` over 12 accents (`domain/technicianColor.ts`): the header badge, every card's rail and the detail panels; never the column index; status keeps its own fill + icon. |
| Words | Every string in `i18n/boardText.tsx` (`BOARD_TEXT_EN`); the host passes `translate` (POS: `bsb` namespace, EN + VI) and `formatMoney`. Times still use the package's `9:00 AM` clock in both languages. |
| 200+ technicians | `pagesOnServer` adapters: the board asks for one page at a time (`page`, `pageSize`, `workingOnly`), uses the server's counts and roster numbers, and `locateTechnician` to jump. The mock keeps client paging. |
| Week view | A technician × day summary (appointments, open minutes, utilisation bar). Clicking a cell returns to Day view on that date. |
| Recurrence for blocked time | Passed through untouched (`recurrence?: unknown`); no UI until the host supports it. |

## 8. What is verified and what is not

**Verified in this package** (see `TEST_REPORT.md`): 47 unit/UI tests, 13 real-Chromium checks, typecheck, build, no-print gate,
and a sabotage run proving the double-booking test fails when serialization is removed.

**Verified after the merge (Nov 13 2026)** — see `TEST_REPORT.md`: real endpoints / field names / refusal bodies
(recorded wire + drift check), spec §39 #1–#7, #10, stale version and tenant isolation on the real BookingService
(PGlite), the board inside the real Booking page in jsdom (prefill, server paging to #200, realtime reload, state restore,
Classic switch, Vietnamese, no print).

**Still not verified:** the real Postgres overlap guard under true parallel load (the PGlite run serialises; the existing
`booking-concurrency.postgres-race` suite needs `PG_RACE_URL`), the live SSE transport, Fair Turn / queue reconciliation
after a host walk-in (acceptance #8), and the 1920×1080 / physical SUNMI 27" layout (no browser run in this session).
