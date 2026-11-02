# GO_CHECK_IN_SPEC_GAP_REVIEW.md

Re-checked the build against the full Go Check-In spec. Most was already complete and verified (audit, secure
tenant/branch resolution from slug, tenant-first→central phone lookup with safe fields, appointment + walk-in check-in
reusing CheckInService, real queue item in the correct tenant, duplicate prevention, realtime to POS, Super-Admin device
lifecycle + UI, tenant settings, kiosk screens, browser guide, isolation tests). This pass found and **closed three real
gaps**:

## 1. §8 — multiple-customer-match safety (CLOSED)
Before: the phone lookup returned the first match. Now: if **2+ tenant profiles share a phone**, the kiosk does **not**
auto-select — it returns `ambiguous: true` + `askFrontDesk: true` with safe labels only (first name + last initial),
offers no walk-in/create, and writes a `ambiguous_match` **staff alert** to the Super-Admin logs. The kiosk shows the
"please ask the front desk" screen.
- Verified live: a phone shared by two LUXE customers → `match:null, ambiguous:true, choices:[{Sam,P.},{Sandra,Q.}]`,
  and a `ambiguous_match` log row was written.
- Test: `go-check-in-isolation.vitest.spec.ts` › "never auto-selects when 2+ tenant profiles share a phone".

## 2. §21 — Super-Admin automated tests (CLOSED)
Added `go-check-in-super-admin.vitest.spec.ts` (6 tests): create setup (slug + URL + one-time token), assign branch +
list, disable → disabled device can't start a session, regenerate → old token stops resolving / new token works, logs
surfaced to Super Admin, settings round-trip. (These were already verified live; now they're automated.)

## 3. §6 — device type / status enum (CLOSED)
Migration `077_go_checkin_device_enums.sql` widens `go_checkin_devices.device_type` to include the spec's kinds
(`ipad_display`, `tablet_kiosk`, `browser_kiosk`, `front_desk_shared`, `qr_code`) and adds the `expired` status.
Verified: a `browser_kiosk` device now inserts (was previously rejected by the CHECK constraint).

## Still open (advanced / lower-priority — see REMAINING_BLOCKERS.md)
- ~~**Multi-branch device config** (§4): default + allowed branches per device.~~ **DONE** — `GO_CHECKIN_MULTIBRANCH_BUILD_REPORT.md` (allow-list validated at session start; chosen branch carried on the session; admin UI + kiosk picker).
- ~~**Token expiration** (§4): tokens auto-expire on a schedule.~~ **DONE** — `GO_CHECKIN_TOKEN_EXPIRY_BUILD_REPORT.md`.
- **POS-station pairing** (§4): "connected POS station if paired" is not modeled.
- **Two extra tenant toggles** (§5): "show customer queue position" and "show loyalty status".
- **Extra realtime event names** (§15): `go_checkin_session_started`, `customer_lookup_completed`, etc. — the key
  check-in events are emitted (`customer_checked_in`, `queue_updated`, `appointment_updated`); the rest are in the logs.
- **True global-customer store** (§14): there is no `global_customers` table in this schema; "central" is a
  privacy-safe cross-tenant phone match returning safe fields only.
- **Native admin-web screen**: a standalone Super-Admin manager UI is provided; porting it into admin-web's Tenant
  Detail as a React screen remains.
None of these block a pilot.

## Tests / build
Full API suite **405/405** (60 files). Clean build. Live-verified end to end against Postgres.
