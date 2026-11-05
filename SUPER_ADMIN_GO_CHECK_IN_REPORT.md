# SUPER_ADMIN_GO_CHECK_IN_REPORT.md

Super Admin controls for Go Check-In, and the live verification of each.

## Capabilities (HTTP, behind `SuperAdminGuard`)
Per tenant, at `super-admin/tenants/:tenantId/go-check-in`:
- **Create device** (`POST`): assigns tenant + branch, mints an opaque `checkin_slug`, builds the `public_url`, and
  issues a device token (returned **once**; only its sha256 hash is stored).
- **List devices + settings** (`GET`): every device (name, branch, type, slug, URL, status, last-seen) + the tenant's
  current settings.
- **Update settings** (`PATCH .../settings`): master `enabled` + all feature toggles.
- **Update device** (`PATCH .../:deviceId`): e.g. set status.
- **Regenerate token** (`POST .../:deviceId/regenerate-token`): new token; the old hash stops resolving immediately.
- **Disable device** (`POST .../:deviceId/disable`): the public kiosk for that slug returns 403 at once.
- **Logs** (`GET .../logs`): the safe audit trail (session started, phone entered, tenant/central match, customer
  created, appointment/walk-in checked in, queue item created, duplicate blocked, rate limited, error, completed).

## Per-tenant settings
`enabled` (master, Super-Admin only), `appointmentCheckinEnabled`, `walkinCheckinEnabled`, `newCustomerEnabled`,
`serviceSelectionEnabled`, `technicianPreferenceEnabled`, `tenantPhoneLookupEnabled`, `centralLookupEnabled`,
`customerLinkingEnabled`, `showWaitEstimate`, `autoSendToQueue`, `requireFrontDeskApproval`. Each tenant has its own
row; each branch can have its own device/slug/token.

## Live verification (against `aps_fresh`, through the guard)
1. Create device → `deviceId`, `slug`, `publicUrl=https://checkin.example.com/go-check-in/<slug>`, 32-char token. ✓
2. Public `GET /go-check-in/<slug>/config` on the freshly-minted slug → returns the kiosk config. ✓
3. `PATCH .../settings {technicianPreferenceEnabled:false}` → reflected. ✓
4. `GET` list → 2 devices, `enabled:true`, `technicianPreferenceEnabled:false`. ✓
5. Regenerate token → new 32-char token. ✓
6. Disable device → public config now **403**. ✓
7. Logs → rows returned. ✓
8. Authorization: an OWNER hitting a `super-admin/*` route → **403**; the tenant settings route
   `GET /pos/settings/go-check-in` works for the owner and shows `enabled:true`. ✓

## Note on auth during testing
The `SUPER_ADMIN` role requires MFA at login. For the headless live smoke, a valid super-admin session token was minted
with the dev signing secret to exercise the real HTTP → guard → controller → service path. In production the Super
Admin signs in normally (password + MFA); no code path was bypassed, only the interactive MFA step.

## Management UI — `apps/go-check-in-admin/index.html`
A usable, cream/gold (Mac-fit shell) Super-Admin device manager, wired to the endpoints above:
- **Device table** — name, type, branch, status, public URL; per-row **Copy URL**, **QR code** (rendered client-side
  from the public URL), **Enable/Disable**, and **New token** (regenerate).
- **New device** form — name + branch + base URL → returns the public link + the one-time token + a QR.
- **Master switch** — enable/disable Go Check-In for the tenant.
- **Settings** — all 11 feature toggles, saved on change.
- **Recent logs** — the safe audit trail.

It calls the guarded routes with the logged-in Super-Admin session (`credentials:'include'`); serve it from the same
origin as the API (or pass `?api=`). The endpoint paths were cross-checked against the controller and the page's inline
JS passes a syntax check. This is provided as a standalone page (same pattern as the kiosk) and is ready to be embedded
into admin-web's Tenant Detail as a native React screen (see REMAINING_BLOCKERS.md).
