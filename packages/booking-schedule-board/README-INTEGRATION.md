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
| `src/domain/` | Pure logic: `scheduleTypes`, `time` (timezone-correct), `availability`, `eligibility`, `openings` (Find an Opening + Best Matches), `paging`, `bookingErrors` |
| `src/adapters/` | `BookingDataAdapter` (interface), `MockBookingDataAdapter` (in-memory authoritative backend), `ProductionBookingDataAdapter` (merge seam) |
| `src/state/` | `boardState` (UI reducer, persistence), `scheduleStore` (per-technician slices, realtime reconciliation) |
| `src/realtime/events.ts` | Typed schedule events, `RealtimeClient` interface, affected-technician routing |
| `src/hooks/useScheduleRange.ts` | One range request per branch/date + subscription + silent resync |
| `src/styles/board.css` | All styles, scoped under `.bsb-root` with `--bsb-*` variables |
| `demo/` | Demo **host** that mounts the board above a placeholder Booking Assistant |
| `scripts/check-no-print.mjs` | Same rule as the host's `check:no-print` gate |
| `scripts/e2e-browser.cjs` | Real-Chromium checks (1920×1080 layout, drag-and-drop, host payload) |

Stack matches `apps/pos-web`: React 18, Vite 5, TypeScript 5 (strict), Vitest + Testing Library. No other runtime
dependencies.

## 2. Running it standalone

```bash
npm install
npm run dev               # http://localhost:5178  (?techs=25&latency=120 query params)
npm run check:all         # typecheck + no-print + unit/UI tests + build
npx vite build && node scripts/e2e-browser.cjs   # real-browser checks + screenshots/
```

## 3. Mounting the board (host contract — spec §5)

```tsx
import { BookingScheduleBoard, ProductionBookingDataAdapter } from '@aipowersalon/booking-schedule-board';

<BookingScheduleBoard
  tenantId={session.tenantId}          // routing only — the server derives the real scope
  branchId={session.branchId}
  userId={session.userId}
  timezone={branch.timezone}           // e.g. "America/New_York"
  selectedDate={restored?.date}
  permissions={boardPermissions}       // resolved from the host RBAC (UX gating only)
  adapter={productionAdapter}
  realtimeClient={posRealtime}         // optional; defaults to adapter.subscribeSchedule
  onOpenBookingAssistant={(ctx) => bookingAssistant.prefill(ctx)}
  onOpenNewBooking={(ctx) => bookingAssistant.prefill(ctx)}
  onOpenAppointment={(appt) => openExistingAppointmentDetail(appt.id)}
  onViewTechnicianDay={undefined}      // omit → board shows its own day panel
  initialState={restored}              // spec §26 state restore
  onStateChange={setRestored}
  showPrimaryToolbar                   // false if the host keeps its own Day/Week/date row
/>
```

### Outbound payload (`BookingContext`)

```ts
{ tenantId, branchId, date, technicianId, startAt /* ISO with offset */, availableDurationMinutes, serviceId?, appointmentId? }
```

`availableDurationMinutes` is what is free **from that cell** up to the next commitment (protection-aware), not the size of
the whole gap. The Booking Assistant must still let the backend decide the final placement.

### Permissions

`BoardPermissions` hides/disables controls only. Every one of them **must** also be enforced server-side (spec §33).

| Flag | Gates |
|---|---|
| `canBook` | `+ Book` cells, View All picks |
| `canMove` / `canReassign` | Drag vertically / across technicians; Move in the appointment sheet |
| `canCancel` | Cancel in the appointment sheet |
| `canBlockTime` | Block time (legend + column menu) |
| `canViewTechnicianDay` | View day |
| `canOverridePrice` | Passed through for the host's forms; the board itself never edits price |

## 4. Adapter contract (spec §6)

`BookingDataAdapter` is the only thing the UI talks to. `ProductionBookingDataAdapter` is a thin, rule-free shell:

- `HttpClient` — inject the host's **existing authenticated** client (cookies/CSRF/tenant headers).
- `EndpointMap` — `DEFAULT_ENDPOINTS` are **placeholders** under `/pos/booking-board/*`. During merge either add a thin
  controller with these routes or point each entry at an existing route.
- `ProductionMappers` — identity by default. Replace each with a real mapping from the host DTOs.
- `HOST_ERROR_CODE_MAP` / `mappers.error` — convert host error payloads (and HTTP 409/403/404) into domain errors. Raw DB
  errors must never reach the board (spec §22).
- Writes send `Idempotency-Key` headers; moves/cancels send `expectedVersion` (optimistic concurrency).

### Required server behaviour (what the mock models and the backend must guarantee)

| Rule | Mock behaviour | Production requirement |
|---|---|---|
| Double booking (spec §21) | Mutations serialized; overlap re-validated at commit | Transaction + overlap guard on the existing appointments table; conflict → `APPOINTMENT_CONFLICT` |
| Full-duration fit (§13) | `slotFits` over working ∩ branch hours − busy | Same rule server-side |
| Protection (§23) | `start + duration ≤ next protected start (− buffer)` | Same rule; `protected` flag mapped from the host model |
| Eligibility (§18) | Exact `technician.serviceIds` | The host's technician↔service relation — one source for every booking path |
| Requested technician | Reassigning a requested-technician appointment is refused | Host policy decides; return `TECHNICIAN_UNAVAILABLE` when refused |
| Fair Turn (§24) | Eligibility first; only the chosen technician's turn is consumed | Delegate `technicianId: 'any'` to the existing Fair Turn service |
| Idempotency (§22) | Repeated key returns the first result | Same |
| Tenant/branch scope (§33) | Unknown scope → `PERMISSION_DENIED`; foreign ids → `NOT_FOUND` | Scope from the session, never from the request body |
| Audit (§34) | `adapter.audit[]` with actor, previous, next | Existing audit service |
| Realtime (§25) | `LocalRealtimeBus` with monotonic `serverVersion` | Existing SSE transport wrapped as `RealtimeClient` |

## 5. Realtime contract (spec §25)

The board consumes `ScheduleEventEnvelope { tenantId, branchId, date, serverVersion, at, event }`. Event types:
`appointment.created|moved|cancelled|reassigned|checked_in`, `walkin.created`, `service.started|completed`,
`blocked_time.created|changed|removed`, `technician.schedule_changed`, `schedule.resync`.

Reconciliation (`state/scheduleStore.ts`):

- Only the affected technicians' slices are rebuilt (`affectedTechnicians`), with a `revision` counter, so other columns do not re-render.
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
| **Print Schedule (spec §3, §30)** | **Not built.** AIPowerSalon has a permanent no-print rule for schedules, queues and service tickets (enforced by the host's `check:no-print` gate, re-confirmed Oct 26 2026). The spec asks for it; building it would fail the host's gate. `BookingLegend` keeps an `actions` slot, and `scripts/check-no-print.mjs` fails the package if a print control is added. |
| Technicians off for the day | Not paged and not counted, so "Working technicians (N)" and "Technicians x–y of N" always agree (spec §19). They are listed as "Off today" in the technician filter. |
| Blocking over an existing appointment | Refused with `APPOINTMENT_CONFLICT` (move or cancel first) rather than silently overlapping. Change in `createBlockedTime` if the host allows overrides. |
| Native dialogs | None. All prompts and confirmations are inline panels (host `check:dialogs` rule). |
| Fonts | The board uses the host font stack via `--bsb-font`; the package loads no external fonts. |
| Colours | The orange/blue palette follows the supplied screenshot; override `--bsb-*` variables to apply the cream/gold POS design system. |
| Week view | A technician × day summary (appointments, open minutes, utilisation bar). Clicking a cell returns to Day view on that date. |
| Recurrence for blocked time | Passed through untouched (`recurrence?: unknown`); no UI until the host supports it. |

## 8. What is verified and what is not

**Verified in this package** (see `TEST_REPORT.md`): 47 unit/UI tests, 13 real-Chromium checks, typecheck, build, no-print gate,
and a sabotage run proving the double-booking test fails when serialization is removed.

**Not verified here (needs the host repository):**

- the real AIPowerSalon endpoints, DTO field names and error payloads that `ProductionBookingDataAdapter` must map;
- the database-level overlap guard on the real appointments table under concurrent load;
- the real SSE transport, its version semantics, and Fair Turn / Tech Queue reconciliation after a walk-in (acceptance #8);
- RBAC enforcement and audit writes in the real API;
- the board inside the real POS shell (sidebar + top bar) on the physical 27" display.
