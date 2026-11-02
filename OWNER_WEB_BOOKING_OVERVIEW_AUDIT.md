# owner-web hardening — BookingOverviewScreen (1 minor fix + verified)

Audited Module 3: a status donut + legend (completed/cancelled/no-show), a 7-day bookings trend, completion/cancellation/
no-show rate cards, and a legend-tap drill-down into the underlying appointments. Read-only; one minor consistency fix.

## Fixed — date label could slip a day west of the salon
The period heading parsed `o.dateFrom` directly with `new Date(o.dateFrom)`. `dateFrom` is a full ISO instant (salon-local
midnight expressed in UTC — confirmed by the dashboard path, which slices the same value to 10 chars for its date-only field).
Parsing the full instant renders it in the **viewer's** timezone, so an owner viewing from a timezone west of the salon, across
the UTC date boundary, would see the **previous day** in the heading. The sibling OwnerHomeScreen already avoids this by pinning
to a date-only string at local midnight (`+ 'T00:00:00'`). Aligned this screen to the same pattern:
`new Date(o.dateFrom.slice(0, 10) + 'T00:00:00')` — `.slice(0,10)` is safe whether `dateFrom` is full-ISO or already
date-only. Correct for the Eastern-TZ target market either way; this removes a latent cross-timezone off-by-one and makes the
two dashboards consistent.

## Verified clean (the rest)
- **Wiring is exact.** `ownerBookingsApi.overview(period, branchId)` ↔ `GET /owner/bookings/overview`, `drillDown({period,
  status, branchId, limit})` ↔ `GET /owner/bookings/drill-down`. Every field the screen reads is present in the backend
  `OwnerBookingOverview` DTO (owner.dto.ts 127–134): `totalBookings`, the `{count, percentage}` sub-objects, `trend[]`, and the
  three `*Rate` + `*RateTrendPercent` fields — and the DTO guarantees percentages are 1-decimal and `0` (never NaN) at total 0.
- **Chart math is safe.** The donut uses `total = Math.max(1, totalBookings)` (and only renders when `totalBookings > 0`);
  `TrendChart` clamps `max` to ≥1 and tolerates an empty series without NaN geometry; `trend()` falls through to a flat branch
  for zero/null.
- **Drill-down is correct.** Tapping a legend status loads that status's appointments and re-tapping the same status toggles it
  closed; failures degrade to an empty list; rows key on `appointmentId`. 403 → honest message + Retry; empty period → "No
  bookings found".

**5 tests** added: donut total + legend counts + rate cards (+ the local-stable date label); legend → drill-down call + row
render + toggle-close; the Daily-period reload; the empty state; and a friendly 403.

## Verification
owner-web `tsc` clean, **63 tests pass** (14 files), `vite build` clean. (admin-web 151, pos-web 75, tech-web 58, customer-web
107, backend 603 / PASS — all unchanged; the change is a client-side date-format alignment, no API surface touched.)

## Sweep status
**10 fixes to date** (admin-web 6, pos-web 1, owner-web 3, tech-web 1). owner-web now has every money screen + the home and
booking dashboards covered. Remaining owner-web is read-only/secondary: StaffPerformance, BranchPerformance, TechnicianDetail,
Alerts, Audit, More, Login, and static Privacy/Terms/Delete-account.
