# BOOKING_HIGH_DENSITY_BUILD_REPORT.md — Advanced Booking Calendar upgrade (2026-07-03)

_Answers to the spec's required completion report, in order. Everything below was verified on this exact tree —
see the verification block at the end for the raw numbers._

**1. Existing implementation found.** The canonical appointment domain already lived at `apps/api/src/booking`
(`/pos/booking/*`: state, KPIs, appointments CRUD, conflict check, availability, day-grid, reschedule, assign,
cancel, no-show, check-in, queue/serving handoffs) with advisory-lock atomic conflict re-checks, schedule windows
(store hours ∩ `technician_schedules` − lunch − `technician_blocked_times`), buffers, manager override, append-only
audit, a failure recorder feeding Super Admin Appointment Oversight, and fire-and-forget notifications.
`POSBookingScreen.tsx` already rendered the KPI row, source/service mix donuts, AI insights, waitlist, available
technicians, quick actions, a Booking Assistant with real availability + slot/gap prefill and the customer mobile
preview, and a day calendar with a true 15-minute grid, sticky time column + headers, real avatars with initials
fallback, Open Today combined ranges, gap indicators, current-time line, blocked hatching, mouse drag-and-drop, and
both full-screen modes. **2. Reused:** all of it — no route, table, service, or screen was duplicated or replaced.

**3. Bugs found.** (a) Open ranges included minutes already in the past on the current day (violating §6);
(b) `FeaturePage`'s AI-locked CTA and the previous session's Open-Today chips lacked the spec's total-minutes
labels; (c) the notification-bell/tab issue and sidebar orphans were fixed in the earlier sidebar pass. No
data-corruption or money-path bugs were found. **4. Missing wiring found:** no blocked-time write path (table was
read-only), no dedicated Move workflow, no assistant access in full screen, no touch drag, fixed 170px columns that
could not fit 20 technicians, no service-fit hints, no per-tech range overflow control.

**5. Frontend files changed:** `apps/pos-web/src/screens/POSBookingScreen.tsx` (calendar rewrite portions),
`apps/pos-web/src/components/MoveAppointmentModal.tsx` (new), `apps/pos-web/src/api/posBookingApi.ts`,
`apps/pos-web/src/screens/POSBookingScreen.test.tsx`. **6. Backend files changed:** `booking.dto.ts`,
`booking.service.ts`, `booking.controller.ts`, `booking.repository.ts`, `booking.kysely.repository.ts`,
`booking-schedule-core.vitest.spec.ts`, `booking-blocked-times.vitest.spec.ts` (new). **7. Database migrations
added: none** — the existing `technician_blocked_times` (035) and its tenant/branch/tech/date index already carry
the feature; the schema needed no change. **8. API routes added/repaired:** `POST /pos/booking/blocked-times` and
`DELETE /pos/booking/blocked-times/:blockId` (both `pos.booking.edit`, audited); `PBRescheduleRequest` gained an
optional `reason` that lands in the reschedule audit metadata; `GET /pos/booking/day-grid` now returns block ids
and clamps today's past minutes.

**9. Open Today ranges** come from `pbTechDayWindows` (store hours ∩ weekly schedule − lunch − blocked windows)
minus buffered blocking-status appointments via `pbOpenRanges`, which merges adjacency by construction — free time
is computed by subtracting busy intervals from continuous windows, so consecutive 15-minute intervals are never
split. **10. Total open minutes** are `end − start` per contiguous range (summed per technician for the header
stats), and **11. gaps between appointments** are the same ranges rendered in-grid: each carries `minutes`, respects
buffers/breaks/blocked/off-shift by construction, and today's ranges are clamped to the current minute (snapped up
to the grid interval) server-side.

**12. The 15-minute grid** is one shared coordinate system: minute-of-day × PX (0.85 standard / 1.15 full-screen);
solid hour rules and dashed :15/:30/:45 rules are absolutely positioned per column at identical offsets, which is
also **13. why the lines stay aligned across all columns** — every column derives from the same `openMin`/`PX`
constants, and appointments/blocks/gaps use the same math, so displayed time equals backend time exactly.

**14. Fitting 20 technicians:** `calColMinWidth(viewportW, 56, colCount, target=20)` divides the usable width
(viewport − sticky 56px time column − chrome allowance) across `min(colCount, 20)` columns, floored at 88px and
capped at 170px; on a 1920px iMac that yields ~91px columns — 20 fit with the time rail (locked by test). Below
150px the layout switches to dense mode: 2-line clamped names/services, smaller avatars, tighter padding, tooltips
carry the full values — nothing overlaps and nothing important is silently hidden. **15. More than 20 technicians:**
the same width is kept (no shrinking past the target) and the board scrolls horizontally with the time column and
headers sticky; there is no technician cap anywhere (locked by test: 30 columns get the same width as 20).

**16. Avatars** come from `technicians.avatar_url` through the day-grid payload; a missing URL renders the
project's initials avatar (never a broken image), at 22px in dense mode / 26px standard / 44px in the single-tech
view. **17. Drag-and-drop** is now a single pointer-event path: press → move past a 4px threshold (mouse) →
live snapped preview showing the proposed start–end while `document.elementFromPoint` tracks the target column →
release posts `POST …/reschedule` (optimistic update, rollback + honest message on 409/validation). **18. Touch**
uses the same path behind a 350ms long-press; moving earlier cancels the timer so native scrolling wins
(pointercancel-aware), activation installs a non-passive `touchmove` preventDefault so the page freezes while
dragging, edge proximity auto-scrolls the container, and Escape cancels. All simulated in tests via a PointerEvent
polyfill (jsdom ships none).

**19. Single-technician full screen** opens from the avatar/name/header: large avatar, date, shift, appointment
count, booked/open minutes, utilization %, the full 15-minute day, blocked windows with per-window ✕ removal, and
a **Block time** mini-form (start/end/reason → the new audited endpoint); Escape and ✕ close it, and the standard
view's scroll position is restored. **20. View All Techs full screen** keeps the date controls, Open Today strip,
grid, gap labels, current-time line and drag, applies the density calculation above, and adds a **Booking
Assistant** toggle; closing restores date, filters (parent state), and the saved scroll offsets. **21. Booking
Assistant integration:** the assistant form was extracted into one shared `assistantBody` node rendered both in its
panel and in the full-screen slide-over (same state, zero duplication); chips, gaps, and columns still prefill it,
and the selected service's total minutes now drive live **fits ✓ / does-not-fit** hints on every range and gap
(§6/§8) — with the server still re-validating on save.

**22. Super Admin Appointment Oversight** connection is unchanged and canonical: booking create failures flow
through `BookingCheckinRecorderPort` into the oversight/failed-events surfaces, reschedules/blocks write
append-only audit events (now including the Move workflow's reason), and no parallel appointment store exists.
The §14 **Move Appointment** modal (drawer → Move…, or the Quick Action with an appointment selected) shows the
original slot, target date/technician, **backend-suggested open ranges from the same day-grid** (only ranges that
fit the duration), computed end time, reason, and a notify-customer toggle — submitting through the same
reschedule endpoint the drag uses.

**23–25. Fresh verification (this tree):**
- Type-check: **0 errors** — api and pos-web (`npx tsc --noEmit`).
- Tests: **api 2,525 passing / 400 files (exit 0)** — includes 4 new same-day-clamp tests and 6 new blocked-time
  tests (permission, validation, overlap + override, dayGrid carve/restore, cross-tenant delete isolation, audit).
  **pos-web 196 passing / 62 files** — includes 11 new tests (density math incl. the 20-on-1920px fit and the
  no-cap rule, fit hints, minutes labels + "+N more"/less, mouse drag commit with snapped time + technician,
  touch long-press activate vs early-move cancel, Escape cancel, Move-modal suggestions + reason + notify, Block
  time POST + ✕ DELETE, fs assistant slide-over). The single pre-existing jsdom unhandled-error notice in this
  test file is unchanged from the pre-upgrade baseline (1 before, 1 after) and affects no assertions.
- Builds: **api and pos-web production builds clean.** Lint on every changed file: **0 errors, 0 warnings.**
- admin-web was not touched by this upgrade; its 715/715 from today's earlier sidebar pass stands.

**26. Honest remaining limitations.** Week view is not built (day view is the reference's primary mode; navigation
is per-day). Keyboard-only appointment *moving* is served by the Move Appointment modal rather than arrow-key
drag. Technician-service eligibility already gates create/assign server-side but is not pre-filtered into the
per-range fit hints (the hint is duration-based; the server remains the authority). Live processor/notification
round-trips still require real provider credentials (unchanged platform posture). `pos-web` virtualization was not
added: 20 columns × a day of appointments renders comfortably without it, and the honest trigger for adding
virtualization is a measured problem, not speculation.
