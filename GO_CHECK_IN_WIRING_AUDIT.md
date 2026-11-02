# Go Check-In (kiosk + admin) — client/backend wiring audit

The two Go Check-In apps (`go-check-in-kiosk`, `go-check-in-admin`) are single-file **vanilla-JS** apps — no TypeScript, so no
compiler guard against the field-name drift this sweep keeps finding. That makes a manual field-for-field wiring audit the right
check. Audited both end-to-end against `go-check-in.public.controller.ts` / `go-check-in.admin.controller.ts` and the service +
DTO. **Result: both clean — every endpoint, request payload, and response field read lines up with the backend.**

## Kiosk (self-check-in flow) — verified
Ten endpoints, all present and correctly shaped:
- `GET :slug/config` → `salonName` + `settings.*` (GoCheckInSettings) ✓
- `POST :slug/start-session` → `{ sessionId, sessionToken, config }` ✓ (reads all three)
- `POST session/:id/lookup-phone {phone}` → `LookupResult`: `match` (tenant: `source/customerId/firstName/lastInitial`;
  central: `source/firstName/lastInitial/maskedEmail`, no `customerId` — and the client correctly creates a profile instead of
  reading one), `appointment` (`appointmentId/startTimeLabel/serviceName/technicianName`), `ambiguous`, `askFrontDesk` — all match ✓
- `POST session/:id/create-customer {firstName,lastName?,email?,phone}` → `{ customerId, firstName }` ✓
- `GET session/:id/services` → `{ services: [{ id, name, durationMinutes }] }` (repo maps `duration_minutes`→`durationMinutes`) ✓
- `GET session/:id/technicians` → `{ technicians: [{ technicianId, name, available }] }` (from the shared CheckInService) ✓
- `POST session/:id/check-in-appointment {appointmentId}` and `…/check-in-walk-in {customerId,customerName,phone,serviceIds,technicianId?}`
  → `CheckInConfirmation` (`status` incl. `already_checked_in`, `firstName`, `estimatedWaitMinutes?`) ✓
- `POST session/:id/complete`, `…/heartbeat` ✓ — token rides as `x-checkin-token` (matches the controller header) ✓

## Admin (device management) — verified
- `GET super-admin/tenants/:t/go-check-in` → `{ devices, settings }`. The device list **maps `id`→`deviceId`** server-side
  (service `listDevices`), and the client reads `deviceId` — so the disable/enable/regenerate buttons target the right id (this
  was the one spot that looked like a possible `id`-vs-`deviceId` mismatch; it is correct). Fields `deviceName/deviceType/branchId/status/publicUrl`
  all match ✓
- `POST …/go-check-in {deviceName,branchId,baseUrl}` → `{ publicUrl, deviceToken, … }` ✓
- `PATCH …/:deviceId {status}`, `POST …/:deviceId/disable`, `POST …/:deviceId/regenerate-token` → `{ deviceToken }` ✓
- `PATCH …/settings {patch}` and the toggle keys all match GoCheckInSettings ✓
- `GET …/logs?limit=` → `{ logs: [{ eventType, safeMessage, createdAt }] }` ✓

## Why no new unit tests here
These clients are thin render+fetch glue with their logic inlined in `index.html`; the backend they call already carries its own
suites (`go-check-in-isolation` + `go-check-in-super-admin`, part of the 603). Unit-testing the clients would mean refactoring
the HTML to extract modules — a structural change whose value doesn't justify the churn for glue this thin. The field-for-field
audit is the appropriate verification.

## Status
No code changes (clean audit). All suites unchanged: backend 603 / PASS; admin-web 151, pos-web 75, owner-web 85, tech-web 74,
customer-web 136, customer-display 26 — all tsc + builds clean.
