# Check-In SMS Consent Capture (Build Report)

Closes the compliance gap surfaced by `A2P_10DLC_REGISTRATION_KIT.md`: the in-salon check-in kiosk collected a phone
number but had **no way to capture SMS consent**, so walk-ins couldn't opt in and check-in couldn't be cited as an opt-in
channel on the A2P campaign. Now consent is captured explicitly at check-in and the customer-web disclosure is
approval-grade. **No prior violation** existed — the creation default was already a safe `false` (no silent opt-in); this
adds the missing *capture*.

## What changed (consent threaded end-to-end, explicit opt-in only)
- **Kiosk** (`apps/go-check-in-kiosk`, synced to www + native mirrors): the new-customer step now shows an **unchecked**,
  disclosure-complete checkbox — "Text me appointment reminders & check-in updates from [salon]. Up to ~6 msgs/mo. Msg &
  data rates may apply. Reply STOP to opt out, HELP for help." It **never blocks check-in** (Continue works either way),
  and its value is sent as `smsConsent` on `create-customer`.
- **Backend** — `smsConsent` → `go-check-in.service.createCustomer` → `CheckInService.createCustomer` (new `smsOptIn` on
  `CreateCustomerRequest` / `CustRec`) → repo write sets **`marketing_sms_opt_in: c.smsOptIn ?? false`** (was hardcoded
  `false`). Absent/false consent ⇒ not opted in. The check-in audit log records whether consent was given.
- **customer-web** — the Settings consent toggles ("Appointment & service texts", "Marketing messages") now carry the
  full disclosure (message types, frequency, "Msg & data rates may apply", STOP/HELP). Transactional and marketing remain
  **separate** opt-ins (`marketing_sms_opt_in` vs `marketing_opt_in`), as carriers require.

## Consent column mapping (for reference)
`customers.marketing_sms_opt_in` = general/transactional SMS (API `smsOptIn`) — what check-in captures.
`customers.marketing_opt_in` = promotional/marketing (API `marketingOptIn`) — separate express-written opt-in.
`customers.marketing_email_opt_in` = email (API `emailOptIn`).

## Tests / verification
- `go-check-in-isolation.vitest.spec.ts` — **22 tests** (+2): consent flows through **only** when the guest checks the box;
  a new customer is **not** opted in by default (no flag ⇒ `smsOptIn` false).
- Backend suite **634 + harness, RESULT: PASS** (was 632). customer-web **42 files / 136 tests**; api + customer-web `tsc`
  clean; customer-web production build succeeds; kiosk script parses + all four copies synced.

## Honest notes
- The kiosk checkbox is verified by JS parse + the API contract; on-device it still needs a real tablet.
- Consent is captured for **new** customers at check-in. The "confirm existing match" path (linking a returning/central
  customer) intentionally does **not** auto-opt-in — those customers manage SMS via their profile, the safe default.
- Two A2P steps remain and are external/Twilio-side: hosting the opt-in mockups + SMS-terms page publicly, and wiring
  STOP/HELP/START auto-replies on each salon's Messaging Service (see the kit §3–§5).
