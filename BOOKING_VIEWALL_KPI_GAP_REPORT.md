# BOOKING_VIEWALL_KPI_GAP_REPORT.md — §16 completion report (2026-07-03)

_Two targeted fixes inside the existing Booking module: (1) KPI cards removed from View All Techs full-screen mode,
(2) live open-gap recalculation after drag-and-drop for both affected technicians. No new page, no duplicate
calendar, no second availability engine. Verification numbers are fresh runs on this tree._

## Audit summary (root causes)
**Problem 1 — KPI cards in View All Techs.** The KPI `.kpis` grid renders in the parent `POSBookingScreen`,
*outside* `BookingCalendar`. In View-All the calendar becomes `position:fixed; inset:0` and visually covers the
page, but the KPI grid still occupied layout height in the normal-page flow underneath (and rendered behind the
overlay). It was never conditionally removed.

**Problem 2 — stale open gaps after a drag.** The optimistic `moveAppointment` updated only
`s.bookings.items` (the appointment cards). The Open-Today chips and gap-minute labels are computed from a *separate*
server object, `grid.columns[].openRanges`, which the handler never touched — so gaps stayed stale until the full
`refetch()` returned, and a cross-tech move updated neither column optimistically.

## 1. Root cause of the KPI cards appearing in View All Techs
As above: the KPI block was rendered unconditionally in the parent, independent of `fs` (full-screen) state.

## 2. Frontend files changed to hide them
`apps/pos-web/src/screens/POSBookingScreen.tsx` — the `.kpis` block is now wrapped in `{fs !== 'all' ? (…) : null}`,
so it is **removed from the render tree** (not `display:none`, not `opacity:0`) whenever View All Techs is active.
No empty band remains; the `.kpis` element is absent from the DOM in that mode (asserted by test).

## 3. How the calendar uses the additional space
With the KPI band gone, the fixed full-screen panel's scroll area grows to `calc(100vh − 150px)` (was 130px, and it
now also hosts the in-calendar control row). Combined with the density columns from the prior upgrade, more
technician rows and columns are visible. The panel already fills the viewport (`inset:0`), so removing the
underlying band means nothing renders behind it and the normal page pays no layout cost while full-screen.

Added inside View-All full screen (spec §2, previously only on the covered normal-page bar): Prev / Date / Next /
Today, technician **search**, **status** filter, **source** filter, and a **Working Today** toggle — so reception
keeps every scheduling control without the KPI dashboard.

## 4. Root cause of stale open-gap minutes
The optimistic updater mutated the appointment list but not the `grid.columns[].openRanges` that the Open-Today and
gap labels read from. Those only refreshed on the authoritative `refetch()`, leaving a stale-gap window after each
drop (and no optimistic update at all for the source technician on a cross-tech move).

## 5. Frontend files changed for drag-and-drop updates
`apps/pos-web/src/screens/POSBookingScreen.tsx`:
- New pure helper `calRecomputeOpenRanges(windows, buffer, busy, notBeforeMinute)` — a faithful mirror of the backend
  `pbOpenRanges` (free = windows − each buffered blocking appointment; same-day past-time clamp). Exported + unit-tested.
- `moveAppointment` now, after moving the card, recomputes `openRanges` + `openMinutes` for **both** the source and
  destination technician columns on `grid` and calls `setGrid(...)`, then saves and `refetch()`es for the
  authoritative reconcile. On rejection it restores **both** `s` and `grid` (`prevGrid`).

## 6. Backend files changed for authoritative availability
**None this turn.** The authoritative path already exists and is reused unchanged: `POST /pos/booking/appointments/
:id/reschedule` → `BookingService.reschedule` validates store hours, technician windows (schedule − lunch − blocks),
buffered conflicts under a per-(tenant,tech,date) `pg_advisory_xact_lock`, permission, and server-derived tenant/
branch, then audits and (best-effort) notifies. `GET /pos/booking/day-grid` returns the authoritative per-tech
windows + open ranges that `refetch()` uses to reconcile the optimistic state. No duplicate engine was created.

## 7. API routes changed
None. Existing `reschedule` + `day-grid` cover the flow.

## 8. How source and destination technicians are recalculated
`moveAppointment` builds an `affected` set of `{sourceTechId, destTechId}`. For each affected column it filters the
just-moved appointment list to that technician's active (non-cancelled/no-show) appointments and runs
`calRecomputeOpenRanges` against that column's `windows`, replacing `openRanges` and `openMinutes`. The source
column regains the vacated time; the destination column's range shrinks/splits — both immediately, before the
server round-trip.

## 9. How adjacent open periods are merged
`calRecomputeOpenRanges` starts from the technician's continuous `windows` and *subtracts* busy intervals; whatever
remains is inherently a set of maximal continuous free ranges (there is no per-slot enumeration to merge). Removing
an appointment simply leaves its slice un-subtracted, so it rejoins the neighbouring free span as one range —
verified by the "vacated period merges" test.

## 10. How optimistic updates work
On drop: (1) move the appointment in `s.bookings.items`; (2) recompute both affected columns' open ranges on `grid`;
(3) `POST …/reschedule`; (4) `refetch()` reloads the authoritative state + day-grid, replacing the optimistic values.
Steps 1–2 are synchronous so the calendar and gap labels update in the same frame as the drop.

## 11. How rollback works
The handler snapshots `prev = s` and `prevGrid = grid` before mutating. If `reschedule` throws (409 conflict, schedule
violation, permission, concurrency), it calls `setS(prev)` **and** `setGrid(prevGrid)` — restoring the appointment,
the open ranges, and the Open-Today summaries together — then surfaces the server's exact message. No partially
updated state remains.

## 12. How concurrency conflicts are handled
Unchanged and reused: the repository's atomic create/reschedule re-checks the technician conflict inside a
transaction under the advisory lock, so a second receptionist targeting the same slot is rejected with a conflict.
The frontend rollback (step 11) then restores that user's calendar and the message tells them to retry against the
refreshed schedule.

## 13. Tests added or updated
`apps/pos-web/src/screens/POSBookingScreen.test.tsx` (+13):
- `calRecomputeOpenRanges`: 60→30→120-min gap transitions (the spec's exact examples), merge on vacate, buffer on
  both sides, cancelled/no-show excluded, same-day clamp.
- View All Techs: KPI labels present on the normal page, **absent** in full screen, `.kpis` element removed entirely
  (no empty band), controls present, close restores the KPI cards.
- Full-screen technician **search** and **Working Today** filter narrow the columns.
Existing booking + Move-modal tests (43) unchanged and green.

## 14–16. Fresh verification (this tree)
- **Type-check:** pos-web tsc **0 errors**.
- **Tests:** pos-web **222/222 (63 files)**; the lone exit-1 is the pre-existing jsdom `scrollIntoView` notice in
  POSBookingScreen.test.tsx carried from earlier turns — not a failure. Backend booking suite unchanged from the
  prior turn (api 2,525/2,525) since no backend file changed.
- **Build:** pos-web production build **clean**.

## 17. Honest remaining limitations
- The optimistic open-range recompute is a faithful mirror of the backend rule but does **not** re-apply *blocked
  time* or *lunch* deltas beyond what's already baked into each column's `windows` (those come from the
  authoritative day-grid, which `refetch()` restores within the same interaction). In practice the bridge window is
  a few hundred ms; the server remains the source of truth.
- Utilization in the per-column header recomputes from the moved list on the next render; the headline KPI
  "Tech Utilization" is a normal-page card and intentionally not shown in View-All.
- Week view is still not built (day view is the reference's primary mode) — unchanged, tracked in REMAINING_ISSUES §9.
