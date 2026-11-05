# BOOKING_AUDIT_REPORT.md — POS Booking (2026-07-03)

_Audited the full Booking screen against the reference image as a strict checklist. Unlike the queue-stage screens,
Booking was already lint-clean with no orphaned handlers (it had heavy prior work this session). The one genuine gap
was that the calendar's filter row — shown prominently at the top of the day view in the image — existed and was
wired, but was only surfaced in the fullscreen controls and the list panel, not the main day-view header. Surfaced it
there and locked it with tests. Everything else verified working end-to-end. Numbers are fresh runs on this tree._

## 1. Modules and boxes found in the picture
9-KPI strip (Appointments Today, Booked Revenue, Walk-ins Scheduled, Online Bookings, AI Booking Conversion,
No-Shows, Open Slots, Tech Utilization) · Day/Week toggle · date nav · filter row (All Services / All Technicians /
All Statuses / All Sources / More Filters) · the technician-column day calendar (drag-to-reschedule, Open-Today
chips, blocked time) · **Booking Assistant** (New Booking / Walk-in tabs; customer, phone, service, technician, date,
time, add-ons, notes; Book Appointment) · **Customer Preview** (live phone mockup, Confirm Booking) · Waitlist /
Standby · Available Technicians · Upcoming Appointments · Channel/Source Mix · Service Mix · Booking Conversion · AI
Insights · Quick Actions · sidebar.

## 2. Problems discovered
- **Calendar filter row not surfaced in the main day header.** The `All Services / All Technicians / All Statuses /
  All Sources` filters were fully wired (state → debounced `load()` → real `/pos/booking/state` refetch of state +
  grid + waitlist), but only rendered in the fullscreen `controls` and the list panel below — not at the top of the
  day calendar where the image shows them. Functionally present, but not where the checklist expects.
- No orphaned handlers, dead dropdowns, or unguarded crashes were found — the Booking Assistant, Customer Preview,
  drag-to-reschedule, Open-Today chips, blocked-time add/remove, and list-panel row actions + Manage drawer were all
  already wired to real endpoints with proper validation (verified, not assumed).

## 3. Frontend files fixed
- `apps/pos-web/src/screens/POSBookingScreen.tsx` — surfaced the four filter dropdowns (service category,
  technician, status, source) in the main day-view header, bound to the **existing** wired state
  (`catFilter` / `techFilter` / `status` / `source`) so they drive the same debounced state+grid refetch. No new
  state, no duplicate logic.
- `apps/pos-web/src/screens/POSBookingScreen.test.tsx` — +2 tests; also made three existing fullscreen/fit-hint
  tests robust to the new header comboboxes (they had relied on DOM order / first-combobox, now they target the
  intended element explicitly).

## 4. Backend files fixed
**None.** `GET /pos/booking/state` already accepts and applies `search` / `status` / `source` / `technicianId` /
`serviceCategory` (and `date`), and `/day-grid`, `/availability`, `/create`, `/blocked-times`, check-in / move-to-
queue / start-service all exist and are covered by the backend suite. All behind `TenantAuthGuard +
RolePermissionGuard`, session-derived tenant/branch.

## 5. Routes and APIs repaired
No routes added or changed. The main-header filters now call the same `/pos/booking/state` refetch the fullscreen
controls already used.

## 6. Database changes
None. Filters narrow existing tenant + branch-scoped queries; money stays integer cents.

## 7. How each module is wired
Calendar filters (service/tech/status/source) + date nav + search → debounced `load({ … })` →
`GET /pos/booking/state` + `GET /pos/booking/day-grid` + `GET /pos/queue/state` (Waitlist) → guarded controllers →
services → repos (tenant+branch scoped, apply each filter) → calendar grid, list, and waitlist re-render. Booking
Assistant: customer/service/tech/date/source/add-ons/notes → **Check availability** → `/pos/booking/availability` →
real open slots → **Book Appointment** → `/pos/booking/create` (validates name/service/time, surfaces 409 conflicts)
→ `refetch()`. Customer Preview renders live from the same form state. Drag-to-reschedule → `/move` with optimistic
open-gap recompute + rollback; blocked-time add/remove → the `technician_blocked_times`-backed endpoints. List rows →
check-in / to-queue / start / Manage (assign + reschedule) → real endpoints.

## 8. Test, typecheck, lint, and build results (fresh, this tree)
- **Typecheck:** pos-web `tsc` **0 errors**.
- **Tests:** Booking screen **51/51** (49 prior + 2 new: the calendar status filter refetches `status=`, the
  calendar service filter populates from facets and refetches `serviceCategory=`). Full pos-web **285/285 across 64
  files**; the lone exit-1 is the pre-existing jsdom `scrollIntoView` notice from POSBookingScreen.test.tsx —
  unrelated to correctness. Backend booking suite **55/55 across 6 files** confirms the state filters + booking
  lifecycle endpoints.
- **Lint:** POSBookingScreen.tsx + its test → **0 warnings, 0 errors**.
- **Build:** pos-web production build **clean**.

## 9. Honest remaining issues
- **Day/Week toggle and More Filters** shown in the image are not implemented — there is no week-view backend or a
  "more filters" surface behind them. Rather than add a Week toggle or More Filters button that does nothing (which
  the checklist forbids), I left them out and am flagging them as genuine future work: a week view needs a
  multi-day grid endpoint, and More Filters needs a defined set of additional facets. The date nav and the four
  primary filters (which the backend supports) are live.
- The header date control label and the calendar are driven by the real `date` param; the small "Today, May 06"
  chip styling matches the image, and navigation is functional.
- Assistant/Preview/filters verified against the in-memory adapter + backend suite; not exercised against live
  Postgres this session.
