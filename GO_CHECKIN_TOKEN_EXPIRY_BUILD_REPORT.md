# Go Check-In Device Token Expiration (Build Report)

Closes the "tokens rotate but don't auto-expire on a schedule" gap from `GO_CHECK_IN_SPEC_GAP_REVIEW.md` (§4). A kiosk
pairing token can no longer live forever — it expires on a TTL, and an expired device is locked out of the customer-facing
path until Super Admin re-pairs it.

## Behavior
- Each device pairing token now has an **expiry**. Default **90 days**, overridable via `GO_CHECKIN_TOKEN_TTL_DAYS`
  (`0` = never expire). Creating a device **or** regenerating its token sets a **fresh** expiry. NULL = never expires, so
  **existing devices are unaffected** until their token is next created/regenerated.
- The device-facing resolve (`resolveDeviceBySlug`, used by `getConfig` + `startSession`) rejects an expired device with
  `403 device_token_expired`, **flips the stored status to `expired`** (so the admin console reflects it), and logs the
  event. The kiosk shows a "please ask the front desk to re-pair" message.
- **Regenerating the token re-activates** an `expired` device (it's freshly paired) and issues a new future expiry.

## What changed
- **DB migration `099_go_checkin_token_expiry.sql`** — `go_checkin_devices.token_expires_at TIMESTAMPTZ` (nullable).
  `kysely.types.ts` updated.
- **`go-check-in.dto.ts`** — pure, exported helpers: `DEVICE_TOKEN_TTL_DAYS`, `deviceTokenTtlDays()` (env-aware),
  `deviceTokenExpiry(now)` → `Date | null`, `isTokenExpired(expiresAt, now)` (null = never). `GoCheckInDevice` gains
  `tokenExpiresAt`.
- **Repository** (interface + Kysely + in-memory) — `setDeviceToken(..., tokenExpiresAt?)` persists the expiry; the device
  mapper carries `tokenExpiresAt`.
- **`go-check-in.service.ts`** — `createDevice`/`regenerateToken` set the expiry + return `tokenExpiresAt` (regenerate also
  re-activates an expired device); `resolveDeviceBySlug` enforces expiry; `listDevices` surfaces `tokenExpiresAt`.
- **Frontend** — `checkInDevicesApi` types carry `tokenExpiresAt`; the **Check-In Devices** screen shows a **Token** column
  ("in 30d" / red "Expired" / "Never", warned within 7 days), the create reveal shows the expiry date, and a regenerate
  reloads the row so its expiry/status refresh.

## Tests / verification
- `go-check-in-super-admin.vitest.spec.ts` — **10 tests** (was 6): `isTokenExpired` (null/past/future) + `deviceTokenExpiry`
  default; new tokens carry a future expiry surfaced in the list; an expired token locks the kiosk out **and** flips the
  device to `expired`; regenerating re-activates it and it resolves again.
- `CheckInDevicesScreen.test.tsx` — **6 tests** (was 5): the Token column flags an expired device while status stays Active.
- Full backend suite **622 + harness, RESULT: PASS**; full admin-web **31 files / 167 tests**; `tsc` clean (api +
  admin-web); production `vite build` succeeds.

## Honest notes
- Expiry is enforced at the device's **slug resolve** (the real customer-facing gate), which is where `startSession` and
  `getConfig` both pass — so it covers the actual kiosk entry, not just a token-hash lookup.
- The flip-to-`expired` happens lazily on the next resolve attempt (no background sweeper). That's sufficient: a device
  can't be used past expiry, and the admin sees `expired` the moment a locked-out kiosk tries to load. A scheduled sweep
  to mark idle-but-untouched devices proactively could be added later but isn't needed for correctness.
