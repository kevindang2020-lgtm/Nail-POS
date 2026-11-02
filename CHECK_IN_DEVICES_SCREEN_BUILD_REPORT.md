# Check-In Devices — Native admin-web Super Admin Screen (Build Report)

Go Check-In device management lived only in a separate standalone app (`apps/go-check-in-admin/`); admin-web had no
check-in screen. This ports it into the admin-web console so kiosks are managed alongside tenants, gateways, hardware, and
billing. **Pure frontend** wired to the existing, already-tested backend routes — no schema, no money path, no isolation
surface touched.

## Backend (unchanged — already built + tested)
`go-check-in.admin.controller.ts` (`@Controller('super-admin/tenants/:tenantId/go-check-in')`, `SuperAdminGuard`): list
devices + settings, create device (token minted **once**), `PATCH settings`, `PATCH :deviceId` (status),
`:deviceId/regenerate-token`, `:deviceId/disable`, `logs`. Covered by `go-check-in-super-admin.vitest.spec.ts` (6 tests).

## Frontend (new)
- **`apps/admin-web/src/api/checkInDevicesApi.ts`** — typed client for all seven routes (`CheckInDevice` /
  `CheckInSettings` / `CheckInLog` / `CreatedDevice` types), via the shared root-relative `api` (`credentials: include`).
- **`apps/admin-web/src/screens/CheckInDevicesScreen.tsx`** — one tenant-aware screen (deep-linkable by `?tenantId=`,
  cream/gold tokens, Mac-fit, reuses `.panel`/`.ttable`/`.badge`/`.btn`/`.toast`/`.dkv`):
  - **Tenant picker** (reuses the Super Admin tenants-state endpoint) synced to the URL.
  - **Master enable** banner + switch (`updateSettings({ enabled })`), with an honest ON/OFF explanation.
  - **Devices table** — name + copyable kiosk URL, type, branch, status badge, last-seen; per-row **Activate /
    Deactivate** (`setStatus`), **Regenerate** (reveals the new token inline, once), **Disable** (red).
  - **Add a device** — name, type (the five device kinds), branch (when the tenant has branches), kiosk base URL → on
    create, the **one-time pairing token + kiosk URL** are surfaced prominently with Copy buttons (shown once, never again).
  - **Feature toggles** — all 11 check-in toggles (appointment, walk-in, new customer, service selection, technician
    preference, tenant/central lookup, customer linking, wait estimate, auto-send to queue, front-desk approval), each an
    optimistic switch calling `updateSettings`.
  - **Recent activity** — the device logs (event + safe message + relative time).
- Wired into `App.tsx` (route `/check-in-devices`) and the sidebar (`Check-In Devices`, after Payment Gateways). Added a
  small reusable `.btn.sm` + `.btn:disabled` style.

## Security / safety
Token shown exactly once on create and on regenerate (never re-displayed or re-fetched). All routes are
`SuperAdminGuard` + explicit `:tenantId`. No secret material is rendered beyond the one-time token the operator must copy.
The standalone `go-check-in-admin` app is untouched — it simply becomes optional now.

## Tests / verification
- **New** `CheckInDevicesScreen.test.tsx` — **5 tests**: tenant load + device/status/master render; master switch →
  `updateSettings({enabled:false})`; a feature toggle → `updateSettings({walkinCheckinEnabled:true})`; create → one-time
  token surfaced + `createDevice` payload; regenerate reveals the new token + disable wires through.
- Full admin-web suite **31 files / 166 tests**; `tsc --noEmit` clean; production `vite build` succeeds.
- Backend untouched (no files changed), so its suite is unaffected.

## Honest note
Live kiosk pairing (a real device consuming the token at the slug URL) is end-to-end exercisable only with a device in
hand; the screen + routes + token lifecycle are unit-proven here.
