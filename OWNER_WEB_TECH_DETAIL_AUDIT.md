# owner-web hardening — TechnicianDetailScreen (verified clean)

Audited the Module 4 drill-in (the screen StaffPerformance taps into): per-technician metrics from
`/owner/staff/:id/performance`. Read-only, fully typed; it checks out.

## Verified clean
- **Route + DTO match exactly.** `ownerStaffApi.technician(id, period)` ↔ `GET /owner/staff/:technicianId/performance` →
  `OwnerTechnicianDetail`. Every field the screen reads is present (owner.dto.ts 154–158): `fullName`, `salesCents`,
  `servicesCompleted`, `rating`, `reviewCount`, `tipsCents`, `commissionCents`, `averageTicketCents`, `bookingCount`,
  `utilizationPercent`, `payrollEstimateCents`, `busyMinutes`, `scheduledMinutes`. Not `any`.
- **Safe rendering.** `money()` is null-safe across all six money stats; a missing/zero `rating` renders `—`; the three error
  states are distinct (404 → "Technician not found.", 403 → access message, otherwise the server message) each with Retry; the
  header falls back to "Technician" before data loads.

No bug. **5 tests** added: the hero sales + services line + the full money/stat grid (tips, commission, average ticket,
utilization, payroll estimate) + the utilization explanation; the dash for an unrated tech; and the 404 / 403 / generic error
messages.

## Verification
owner-web `tsc` clean, **80 tests pass** (17 files), `vite build` clean. (admin-web 151, pos-web 75, tech-web 74,
customer-web 124, backend 603 / PASS — all unchanged; read-only screen, only new tests added.)

## Sweep status
**10 fixes** to date (admin-web 6, owner-web 3, pos-web 1, tech-web 1). owner-web coverage now spans the money screens, home,
booking, alerts, staff performance, and technician detail. Remaining owner-web: BranchPerformance, Audit, More, Login, and the
static legal/delete screens.
