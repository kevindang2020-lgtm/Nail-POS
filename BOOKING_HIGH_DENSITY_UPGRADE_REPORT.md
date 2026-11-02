# BOOKING_HIGH_DENSITY_UPGRADE_REPORT.md — §22 completion report (2026-07-03)

_High-density advanced Booking calendar upgrade, built inside the existing monorepo per the spec. No standalone
demo, no duplicate module, no fabricated data. Verification numbers at the bottom are fresh runs on this tree._

## 1. Existing implementation found (audit summary)
The canonical appointment domain already lived at `apps/api/src/booking` (controller/service/dto/repository port +
in-memory and Kysely adapters): state/KPIs, CRUD, conflict check, availability, **day-grid** (per-tech windows =
store hours ∩ weekly `technician_schedules` − lunch − `technician_blocked_times`, plus open ranges w/ minutes),
reschedule/assign/cancel/no-show/check-in, queue/serving handoffs, advisory-lock atomic conflict re-check
(`pg_advisory_xact_lock` per tenant+tech+date), buffers, manager overrides, append-only audit, failed-event recorder
→ Super Admin Appointment Oversight, fire-and-forget notifications. The frontend `POSBookingScreen` already had the
KPI row, source/service mix donuts, AI insights, waitlist, available technicians, quick actions, Booking Assistant
(real availability + slot/gap prefill), a true 15-minute grid with sticky time column/headers, real avatars with
initials fallback, Open Today combined ranges, gap indicators, current-time line, blocked hatching, mouse HTML5
drag-and-drop, and both full-screen modes.

## 2. Existing code reused
Everything above. The upgrade extended `booking.dto.ts` pure helpers, `booking.service.ts`, both repository
adapters, `posBookingApi.ts`, `POSBookingScreen.tsx` (BookingCalendar), and reused the same
`POST …/reschedule` path for the new Move workflow. Nothing was duplicated or rebuilt.

## 3. Bugs found
- **Same-day past time reported as open** — `dayGrid` open ranges included morning minutes already in the past
  (spec §6 violation). No other functional bugs found in the booking domain.

## 4. Missing wiring found
- No add/remove endpoints for `technician_blocked_times` (table read-only since migration 035).
- No dedicated Move workflow (only raw datetime reschedule in the drawer).
- Booking Assistant unreachable inside full-screen mode.
- Open Today chips lacked total-minute labels and overflow control; no service-fit hints.
- No touch drag path; no edge auto-scroll; full-screen columns hard-floored at 170px (20 techs couldn't fit).

## 5. Frontend files changed
`apps/pos-web/src/screens/POSBookingScreen.tsx` (calendar rewrite + parent wiring),
`apps/pos-web/src/components/MoveAppointmentModal.tsx` (new), `apps/pos-web/src/api/posBookingApi.ts`,
`apps/pos-web/src/screens/POSBookingScreen.test.tsx`, `apps/pos-web/src/components/MoveAppointmentModal.test.tsx` (new).

## 6. Backend files changed
`apps/api/src/booking/booking.dto.ts`, `booking.service.ts`, `booking.repository.ts`,
`booking.kysely.repository.ts`, `booking.controller.ts`, `booking-schedule-core.vitest.spec.ts`,
`booking-blocked-times.vitest.spec.ts` (new).

## 7. Database migrations added
**None.** `technician_blocked_times` (035) already existed with the right shape and indexes; the upgrade added the
write path only. No schema change was needed — per audit-first/reuse-don't-duplicate.

## 8. API routes added or repaired
Added: `POST /pos/booking/blocked-times`, `DELETE /pos/booking/blocked-times/:blockId` (both
`@RequirePermission('pos.booking.edit')`, audited). Repaired: `GET /pos/booking/day-grid` (same-day clamp; blocked
slices now carry `blockId`); `POST …/reschedule` accepts optional `reason` (→ audit metadata).

## 9. Continuous Open Today ranges
Server-side in `pbOpenRanges`: the technician's bookable windows (store hours ∩ schedule − lunch − blocks) minus
every buffered blocking-status appointment, yielding maximal contiguous free ranges — never per-slot lists.

## 10. Total open minutes
Each range carries `minutes = end − start` (minute-of-day integers); a column's `openMinutes` is their sum.

## 11. Gaps between appointments
The same `pbOpenRanges` output rendered in-column: a free range between bookings displays `N min open` (or
`Open until H:MM` when it's the trailing range of the tech's shift), and is click-to-book.

## 12. 15-minute grid rendering
One absolute-positioned coordinate system per column: `top = (minute − open) × PX`, `height = duration × PX`
(PX 0.85 standard / 1.15 full-screen). Hour lines solid, :15/:30/:45 dashed.

## 13. Grid alignment across columns
The lines are drawn per column from the same `hours`/`quarters` arrays at identical offsets inside equal-height
(`totalH`) columns in one flex row — a line at minute *m* lands at the same y in every column by construction, and
the shared sticky time rail uses the same formula.

## 14. Fitting 20 technicians full-screen
`calColMinWidth(viewportW, 56, colCount, target=20)`: usable width = viewport − sticky time column − chrome, divided
by `min(colCount, 20)`, clamped to [88px, 170px]. At 1920px → 91px columns; 56 + 20×91 = 1876px fits. Live-resizes
with the window. Under 150px the layout enters *dense* mode: 2-line clamped names/cards, smaller avatar, tighter
padding — wrapping, never overlap, full values in tooltips/aria-labels.

## 15. More than 20 technicians
The divisor caps at 20 but the tenant doesn't: extra columns keep the 88px floor and scroll horizontally under the
sticky headers/time rail. Locked by test (`calColMinWidth(900,56,40) === 88`). No hard-coded limit anywhere.

## 16. Technician avatars
`technicians.avatar_url` flows through the day-grid → `TechAvatar` renders the real image, or a deterministic
initials disc (first letters, cream/gold) when null. No stock photos, no broken images.

## 17. Drag-and-drop
Unified pointer events. Mouse/trackpad: pointerdown arms a preview; the first >4px move activates; the target column
resolves via `elementFromPoint().closest('[data-cal-col]')`; Y→minute snaps with `calSnap` to the 15-min grid,
clamped to store hours; the preview shows the proposed range; pointerup commits `POST …/reschedule`
(optimistic update, server re-validates windows + conflicts under the advisory lock, UI rolls back on 409/400).
A press without movement opens the appointment (keyboard Enter/Space still works via the `e.detail===0` click path).

## 18. Touch drag-and-drop
Same path with a 350 ms long-press gate: a swipe before the timer lets native scrolling win (threshold +
pointercancel); once active, a non-passive `touchmove` guard freezes page scroll, the container auto-scrolls within
44px of its edges, Escape cancels. Cards advertise "press and hold" in their tooltips.

## 19. Single-technician full screen
Clicking a technician's avatar/name/header opens their full day fixed-inset over the app shell (same routing/state —
not a new page): large avatar, name, date, appointment count, booked/open minutes, utilization %, Open Today
summary, full grid with blocks (now removable ✕) and a **Block time** inline form (start/end/reason →
`POST /blocked-times`). Escape or ✕ closes; standard-mode state is untouched underneath.

## 20. View All Techs full screen
The `View All Techs ⤢` button expands the calendar panel to the full viewport with density-computed columns,
sticky rail/headers, all indicators, a **Booking Assistant** slide-over toggle, and ✕/Escape close. Date, filters,
and selections live in parent state so they survive; the standard-mode scroll position is captured on entry and
restored on close via `requestAnimationFrame`.

## 21. Booking Assistant integration
One `assistantBody` JSX tree renders both in the standard panel and the full-screen slide-over (shared state — no
duplication). Chips, gaps, and empty grid areas prefill technician/date/time; selected service duration feeds
`calFitsIn`, marking every range/gap `✓ fits` or `does not fit` (color-independent: text + title + aria-label).
Successful booking refetches state + day-grid, recalculating ranges, gaps, totals, and utilization.

## 22. Super Admin Appointment Oversight
Unchanged canonical wiring, verified: booking failures classify through `bookingFailureClassification` into the
`BookingCheckinRecorderPort` consumed by the oversight module; all mutations (including the new block-time ops and
move reasons) land in the append-only audit trail the oversight/audit surfaces read. No parallel service or table.

## 23–25. Fresh verification (this exact tree)
- **Type-check:** 0 errors — api, pos-web (and the other 7 workspaces untouched).
- **Tests:** api **2,525/2,525 (400 files, exit 0)**; pos-web **212/212 (63 files)** — the single pre-existing
  POSBookingScreen jsdom unhandled-error notice is unchanged from the session baseline and unrelated.
  New coverage: same-day clamp (4), blocked-time service (6), density/fit helpers, minute-labeled chips + "+N more",
  fit hints, blocked ✕ → DELETE, mouse drag commit + Escape cancel, touch long-press vs swipe, fs slide-over +
  Escape restore, single-tech Block time → POST, Move modal (4: real suggestions, reason+notify body, tech switch,
  409 surfaced).
- **Builds:** api and pos-web production builds clean.

## 26. Honest remaining limitations
Consolidated in REMAINING_ISSUES.md §9: week view not built (day view is the reference's primary mode);
dev-environment notifications audit `not_configured` honestly; missing weekday schedule rows deliberately fall back
to store hours. Live processor/notification round-trips still await real credentials (pre-existing, unrelated).
Column virtualization was not added: 20 absolutely-positioned columns × hundreds of cards render well within React's
budget here, and the day-bounded queries keep payloads small — virtualize only if a real tenant profile shows need.
