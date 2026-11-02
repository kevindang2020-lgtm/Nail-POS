# GO_CHECK_IN_BROWSER_TEST_GUIDE.md

How to exercise Go Check-In in a real browser, end to end.

## 0. Prerequisites
- API running with Postgres (`REPO_DRIVER=postgres`). Migration `076_go_checkin.sql` applied.
- A tenant with Go Check-In enabled and at least one device (create via Super Admin, below).
- Serve the kiosk page: open `apps/go-check-in-kiosk/index.html` in a browser (or host it statically).

## 1. Create a device (Super Admin)
`POST /super-admin/tenants/:tenantId/go-check-in` with `{ "deviceName": "Lobby iPad", "branchId": "<branch>",
"baseUrl": "https://your-host" }`. Copy the returned `checkinSlug` (and `publicUrl`). Ensure the tenant is enabled:
`PATCH /super-admin/tenants/:tenantId/go-check-in/settings { "enabled": true }`.

## 2. Open the kiosk
Browse to `…/apps/go-check-in-kiosk/index.html?slug=<SLUG>&api=<API_BASE>` (omit `api` if the page is served from the
same origin as the API). You should see the cream/gold **Welcome** screen with the device name.

## 3. Existing customer + appointment
- Tap **Check In** → enter the phone of a customer who has a booking today → **✓**.
- Expect the **Appointment Found** screen (time, service, technician). Tap **I’m Here**.
- Expect the **Confirmation** screen. Verify in the POS that the appointment is `checked_in` and a queue item exists for
  the correct tenant/branch (POS Check-In / Queue).

## 4. Existing customer, walk-in
- Enter an existing tenant customer's phone → on the match screen choose walk-in (or a customer with no appointment).
- Pick a service, optionally a technician → **Confirm**. Verify a `waiting` queue item in the correct tenant.

## 5. Central customer (not in this tenant)
- Enter a phone that exists only at a different salon. Expect **“Is this you?”** showing first name + last initial +
  masked email **only**. Confirm → a tenant profile is created here → continue to walk-in. Verify no other-tenant data
  was ever shown.

## 6. New customer
- Enter an unknown phone → **Create your profile** → first/last/email → continue → walk-in. Verify the new customer was
  created under the correct tenant.

## 7. Duplicate prevention
- Immediately check the same customer in again → expect **“You’re already checked in.”** and **no** second queue item.

## 8. Disable device
- `POST /super-admin/tenants/:tenantId/go-check-in/:deviceId/disable`. Reload the kiosk → it should show check-in is
  off (config 403). Re-enable by creating/enabling a device again.

## 9. Security spot-checks
- Editing the URL slug to another value → “not available” (404) unless that slug is a real, active device for its own
  tenant. There is no way to pass a `tenantId`; the kiosk cannot check a customer into the wrong salon.
- Let the kiosk sit idle > 10 minutes, then act → the session expires and the kiosk starts fresh.

## Headless equivalents (curl)
All of the above were verified headlessly; see BUILD_AND_TEST_REPORT.md for the exact curl sequence and results.
