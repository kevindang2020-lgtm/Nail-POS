# GO_CHECK_IN_BUILD_REPORT.md

What was built for **AIPowerSalon Go Check-In** — a separate customer-facing kiosk/browser self check-in that connects
directly to the correct tenant POS. Built into the real monorepo, reusing the existing check-in stack (no duplicate app).

## Backend (`apps/api/src/go-check-in/`)
- `go-check-in.dto.ts` — token hashing (sha256 + constant-time compare), slug/token minting, **last-10-digit phone
  normalization** (robust to `+1`/formatting and the existing `customers.normalized_phone` convention), email masking,
  per-tenant settings model, public payload types, rate-limit + idle-expiry constants, log event vocabulary.
- `go-check-in.repository.ts` — `GoCheckInDataPort` + a seedable in-memory implementation (devices, sessions, settings,
  logs, tenant/central customer lookups, today's appointment, services, duplicate guards).
- `go-check-in.kysely.repository.ts` — Postgres implementation; every read/write is tenant-scoped.
- `go-check-in.service.ts` — the orchestration. Resolves the device from the slug **on the server**, opens a token
  session, validates every action (token + status + idle expiry + device-still-active + master-enabled), does the
  tenant-first→central phone lookup, and performs check-ins by **reusing `CheckInService`** through a synthetic kiosk
  `CheckInContext` (tenant/branch come from the device, never the client). Materializes the queue item via
  `CheckInService.moveToQueue` (gated on `autoSendToQueue`/`requireFrontDeskApproval`). Super-Admin device management +
  tenant settings methods.
- `go-check-in.public.controller.ts` — `@Controller('go-check-in')`, **no auth guards**; session token via
  `x-checkin-token` / `?token=`. Maps `GoCheckInError.status` to the right HTTP code.
- `go-check-in.admin.controller.ts` — `GoCheckInAdminController` (`SuperAdminGuard`, `super-admin/tenants/:tenantId/go-check-in`)
  + `GoCheckInSettingsController` (`TenantAuthGuard`+`RolePermissionGuard`, `pos/settings/go-check-in`).
- `go-check-in.module.ts` — wires Kysely-or-in-memory + injects `CheckInService`; registered in `app.module.ts`.
- `app.module.ts` — the `go-check-in/*` prefix is added to the session-middleware **exclude** list (public), while
  `super-admin/*` and `pos/settings/*` stay authenticated.

## Database — migration `076_go_checkin.sql` (applied)
`go_checkin_devices`, `go_checkin_sessions`, `go_checkin_logs`, `tenant_checkin_settings`. UUID PKs, TIMESTAMPTZ, hashed
tokens only, unique slug + unique token-hash. Existing `customers` / `pos_tech_appointments` / `pos_queue_items` are
reused for the rest. `kysely.types.ts` updated.

## Endpoints (all live-verified)
Public: `GET :slug/config`, `POST :slug/start-session`, `POST session/:id/heartbeat`, `lookup-phone`,
`confirm-customer`, `create-customer`, `GET today-appointments`, `POST check-in-appointment`, `GET services`,
`GET technicians`, `POST check-in-walk-in`, `GET check-in-status`, `POST complete`.
Super Admin: `GET/POST super-admin/tenants/:tenantId/go-check-in`, `PATCH .../settings`, `PATCH .../:deviceId`,
`POST .../:deviceId/regenerate-token`, `POST .../:deviceId/disable`, `GET .../logs`.
Tenant: `GET/PATCH pos/settings/go-check-in`.

## Frontend — `apps/go-check-in-kiosk/index.html`
Self-contained cream/gold kiosk (Playfair Display + Hanken Grotesque). Screens: Welcome, Phone Entry (large keypad),
Match Confirm, New Customer, Appointment Found (“I’m Here”), Walk-In Service Select, Technician Preference,
Confirmation (+ wait estimate), Already Checked In, Ask Front Desk, Offline/Error. Derives the device slug from
`?slug=`, opens a session, heartbeats, and drives the public API. Point a kiosk browser at
`…/apps/go-check-in-kiosk/index.html?slug=<SLUG>&api=<API_BASE>`.

## Reuse, not duplication (per the audit)
The kiosk does **not** reimplement check-in. Walk-in, appointment arrival, create-customer, technicians, and queue
materialization all go through the existing `CheckInService`, so kiosk check-ins land in the same place front-desk
check-ins do — and inherit the existing tenant scoping and idempotency.

## Realtime (POS live updates)
On a successful check-in the service emits to the tenant/branch room of the existing realtime bus (`REALTIME`):
`queue_updated` and `customer_checked_in` (appointment check-ins also emit `appointment_updated`). The events carry
the `screens` to refetch, so POS Dashboard/Check-In/Queue/Tech-Queue update live. Emission is optional + best-effort
(never fails a check-in). Verified live: a POS SSE subscriber received both events from a public kiosk walk-in.
