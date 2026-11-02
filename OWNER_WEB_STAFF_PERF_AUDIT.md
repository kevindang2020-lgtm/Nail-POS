# owner-web hardening — StaffPerformanceScreen (verified clean)

Audited Module 4: a Technicians tab (top-tech table + Today's Snapshot KPIs) and an Attendance tab (status tiles). Read-only,
fully typed; it checks out.

## Verified clean
- **Wiring matches the DTO field-for-field.** `ownerStaffApi.performance(period, branchId)` ↔ `/owner/staff/performance` →
  `OwnerStaffPerformanceState` and `ownerStaffApi.attendance(branchId)` ↔ `/owner/staff/attendance` →
  `OwnerStaffAttendance`. Every read is present: `OwnerTopTechnician` (owner.dto.ts 145) has `technicianId`, `fullName`,
  `roleLabel`, `servicesCompleted`, `salesCents`, `rating`; the snapshot reads `totalStaff`, `onDutyCount`,
  `utilizationPercent`, `utilizationTrendPercent`, `totalCommissionCents`; and the attendance tiles read all seven of
  `scheduled`, `clockedIn`, `onBreak`, `offShift`, `absent`, `late`, `overtime` (152). Neither is `any`.
- **No display-time edge crashes.** `money()` is null-safe; `trend()` falls through to a flat branch for zero/null; `initials()`
  returns `'T'` for an empty name; a missing/zero `rating` renders `—` rather than `0.0`. Empty top-tech list → honest empty
  state; 403 → friendly message + Retry; loading state honest.

No bug. **6 tests** added: the technician table + money/rating + snapshot KPIs; the dash for an unrated technician; tapping a row
through to the technician detail; the Attendance tab tiles; the empty state; and a friendly 403.

## Verification
owner-web `tsc` clean, **75 tests pass** (16 files), `vite build` clean. (admin-web 151, pos-web 75, tech-web 74,
customer-web 119, backend 603 / PASS — all unchanged; read-only screen, only new tests added.)

## Sweep status
**10 fixes** to date (admin-web 6, owner-web 3, pos-web 1, tech-web 1). owner-web coverage now spans the money screens, home,
booking, alerts, and staff performance. Remaining owner-web: BranchPerformance, TechnicianDetail, Audit, More, Login, and the
static legal/delete screens.
