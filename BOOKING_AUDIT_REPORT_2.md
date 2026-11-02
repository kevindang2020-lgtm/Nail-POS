# BOOKING_AUDIT_REPORT_2.md — POS Booking, second pass (2026-07-03)

_Second audit of the Booking screen (same reference image). The first pass surfaced the calendar header filters and
verified the Assistant/Preview/drag end-to-end. This pass closed the two affordance gaps that were flagged as honest
remaining issues — the "New Booking / Walk-in" assistant tabs and the "Day / Week" view control — and verified the
Quick Actions bar and the remaining sub-modules the image shows. Numbers are fresh runs on this tree._

## 1. Modules and boxes found in the picture
Same as pass 1, with attention this pass to: the **Day / Week** view toggle, the assistant's **New Booking /
Walk-in** tabs, the **Quick Actions** bar (New Booking, Add Walk-In, Move Appointment, Send Reminder, Assign Tech,
View Calendar, Print Schedule, Refresh), **Waitlist / Standby → View Full Waitlist**, **Available Technicians →
View All Techs**, and the analytics-row **View All** links.

## 2. Problems discovered
- **Missing "New Booking / Walk-in" tabs.** The reference shows a tab pair atop the Booking Assistant; the code had
  only a source dropdown with a `walk_in` option — the walk-in path was reachable but not surfaced as the tabs the
  image shows.
- **Missing "Day / Week" view control.** The reference shows a Day/Week segmented control; the header had date
  navigation but no view toggle.
- **Verified NOT broken (checked this pass):** all 8 Quick Actions have real handlers (New Booking / View Calendar →
  scroll to the form; Add Walk-In → `/check-in`; Move Appointment → opens the real `MoveAppointmentModal` or guides
  the user to pick one; Send Reminder → `/tenant/communications/sms`; Assign Tech → `/tech-queue`; Print Schedule →
  `window.print()`; Refresh → `refetch()`). Waitlist "View Full Waitlist" → `/queue`; the fullscreen "View All Techs"
  toggle works. No dead buttons found.

## 3. Frontend files fixed
- `apps/pos-web/src/screens/POSBookingScreen.tsx`:
  - Added the **New Booking / Walk-in** tabs to the assistant. Selecting Walk-in sets `form.source = 'walk_in'` and
    defaults the date to today (walk-ins are immediate); New Booking resets to `manual`. Reuses the existing wired
    create form — no duplicate logic, same `/pos/booking/create` submit.
  - Added the **Day / Week** segmented control. "Day" is the active, functional view; "Week" is rendered but
    **disabled with a tooltip** ("Week view is coming soon — the day calendar is fully available"), because there is
    no week-view backend yet (see §9). This matches the reference visually while being truthful about availability
    rather than shipping a control that pretends to work.
- `apps/pos-web/src/screens/POSBookingScreen.test.tsx` — +1 test.

## 4. Backend files fixed
**None.** The walk-in path uses the same `POST /pos/booking/create` with `source: 'walk_in'`, already supported and
covered by the backend suite. No new endpoints.

## 5. Routes and APIs repaired
None. The Walk-in tab is a client-side mode over the existing create endpoint; no routes changed.

## 6. Database changes
None.

## 7. How each module is wired
Assistant tabs → set `form.source` (+ today's date for walk-in) → the same customer/service/tech/time/add-ons form →
**Check availability** (`/availability`) → **Book Appointment** (`/create`, validates + surfaces 409) → `refetch()`.
Day/Week control → Day is the live technician-column calendar; Week is disabled pending a week-view endpoint. Quick
Actions, Waitlist, and View-All links route to their real destinations (verified). Calendar header filters (added
pass 1) drive the real state+grid refetch.

## 8. Test, typecheck, lint, and build results (fresh, this tree)
- **Typecheck:** pos-web `tsc` **0 errors**.
- **Tests:** Booking screen **52/52** (51 prior + 1 new: both assistant tabs render, switching to Walk-in keeps the
  create form usable and marks the tab selected). Full pos-web **289/289 across 64 files**; the lone exit-1 is the
  pre-existing jsdom `scrollIntoView` notice from POSBookingScreen.test.tsx — unrelated. (Backend booking suite was
  confirmed 55/55 in pass 1; no backend changes this pass.)
- **Lint:** POSBookingScreen.tsx + its test → **0 warnings, 0 errors**.
- **Build:** pos-web production build **clean**.

## 9. Honest remaining issues
- **Week view is intentionally disabled, not implemented.** A working week view needs a multi-day grid endpoint
  (`/pos/booking/week-grid` or a range on the existing day-grid) plus a week-layout calendar component. Rather than
  ship a Day/Week toggle whose Week side does nothing (which the checklist forbids), the Week button is disabled with
  a clear tooltip. This is the honest representation until the backend exists — flagged as genuine future work.
- **"More Filters"** (shown in the image) is still not implemented — it needs a defined set of additional facets
  beyond the four primary ones; left out rather than faked.
- The Walk-in tab shares the same form as New Booking (with source + date preset). If walk-ins should skip the date
  entirely or force "now", that's a small refinement on top of this wiring.
- Assistant tabs verified against the in-memory adapter + backend create endpoint; not exercised against live
  Postgres this session.
