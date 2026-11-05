# Operations Oversight — Deep-Chain Wiring Matrix (verified end-to-end)

Section: **Operations Oversight**. All routes behind `@UseGuards(SuperAdminGuard)` (server-side
`SUPER_ADMIN`, tenants 403). Modules below are all registered in AppModule
(`SuperAdminCustomerDataModule`, `SuperAdminAppointmentOversightModule`, `SuperAdminStaffModule`,
`SuperAdminBookingCheckinModule`, `SuperAdminCheckinModule`, `SuperAdminQueueModule`).

## 1. Customer Data Oversight  (most sensitive — privacy / deletions)
- `/customer-data-oversight` (+ duplicate-detection, import-history, merge-history, privacy-requests,
  data-exports, deletion-requests, consent-status, audit-history, legal-hold) → `CustomerDataOversightScreen`
  → `superAdminApi`
- Sensitive **POST** `customer-data-oversight/legal-holds` + `/legal-holds/:id/release`;
  `customer-data-oversight/deletions` + `/:id/approve` + `/:id/reject` + `/:id/execute`;
  **GET** `customer-data-oversight/merges` → `SuperAdminCustomerDataController` (`@Controller('super-admin')`,
  `SuperAdminGuard`) → service → `SuperAdminCustomerDataModule` (in AppModule)
- **Audit (rich):** `customer_deletion_requested / approved / rejected / blocked / executed` and
  `customer_import_staged` — each record carries `actorUserId`, `ip`, `tenantId`, `customerId`, and detail
  (reason / errors). **Legal hold enforced:** a blocked deletion records `legalHoldBlocked`, i.e. a legal hold
  prevents execution.
- DB: migrations **127** (customer_privacy_requests), **232** (customer_legal_holds), **234**
  (customer_deletion_requests), **288** (audit_legal_holds), **128/129** (merge logs).
- Permission: `SUPER_ADMIN`. Tests: **10 spec files**. **Status: Complete.**

## 2. Appointment Oversight  (monitoring — read-only by design)
- `/appointment-oversight` (+ search, booking-source, failures, duplicates, overlapping, rescheduled,
  change-history, missing-info, sync-failures) → `AppointmentOversightScreen`
  → `superAdminAppointmentOversightApi`
- **GET** `/super-admin/appointment-oversight/*` → `SuperAdminAppointmentOversightController`
  (`SuperAdminGuard`) → service → `SuperAdminAppointmentOversightModule` (in AppModule)
- No mutations — this is oversight, not the tenant booking calendar (per spec). No audit needed on a
  read-only surface. Tests: 1 spec. **Status: Complete (read-only monitor).**

## 3. Workforce Oversight
- `/staff` (+ role/status/panel query views, Transfers, Payroll Sync) → `StaffOverviewScreen`
- **GET** `/super-admin/staff/*`; **DELETE** `staff/workforce-views/:id` (saved-view management) →
  `SuperAdminStaffController` (`SuperAdminGuard`) → service → `SuperAdminStaffModule` (in AppModule)
- Permission: `SUPER_ADMIN`. Tests: **23 spec files**. **Status: Complete.**

## 4. Booking & Check-In Monitor
- `/booking-checkin` (+ booking-sources, check-in-performance, failed-events, wait-time-analysis) →
  `BookingCheckinScreen` → `superAdminBookingCheckinApi`
- **GET** `/super-admin/booking-checkin/*` → `SuperAdminBookingCheckinController` (`SuperAdminGuard`) →
  service (**10 audit refs**) → `SuperAdminBookingCheckinModule` (in AppModule). (Check-in devices also via
  `SuperAdminCheckinModule`, `/super-admin/checkin`.)
- Permission: `SUPER_ADMIN`. Tests: 2 (+1 checkin). **Status: Complete.**

## 5. Live Queue Monitor
- `/queue-management` (+ timelines) → `QueueManagementScreen`
- **GET** `/super-admin/queue/*` → `SuperAdminQueueController` (`SuperAdminGuard`) → service (**8 audit
  refs**) → `SuperAdminQueueModule` (in AppModule)
- Permission: `SUPER_ADMIN`. Tests: **5 spec files**. **Status: Complete.**

## Invariants confirmed
- Customer deletions follow a **request → approve/reject → execute** workflow with human approval; **legal
  holds block execution**; every step is audited with actor + IP + before/reason.
- Appointment oversight is strictly read-only (does not act as a booking calendar).
- All routes server-guarded (`SuperAdminGuard`); no client-trusted tenant scoping.
