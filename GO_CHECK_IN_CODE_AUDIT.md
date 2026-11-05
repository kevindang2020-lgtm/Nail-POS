# GO_CHECK_IN_CODE_AUDIT.md

Audit performed **before** writing any new code, per the build spec §1. Goal: reuse/merge what exists, fix what's
broken, never duplicate the existing check-in stack, and resolve tenant/branch on the **server** only.

## Headline findings

1. There is **no** existing `GoCheckIn` / kiosk module and **no** `go_checkin_*` tables. So the Go Check-In feature is
   genuinely new — but most of its building blocks already exist and must be **reused, not rebuilt**.
2. `apps/api/src/check-in/public-check-in.dto.ts` already defines the **customer self check-in kiosk DTOs by slug**
   (lookup → appointment-arrived → walk-in → confirmation) with the correct security notes — but it is **DTO-only, never
   wired** to a controller/service. → Implement against it; do not redefine the shapes.
3. `apps/api/src/customer-display/` is the **security template**: a public, token-scoped device flow where tenant/branch
   are resolved **server-side** from a hashed device token (`sha256` + `timingSafeEqual`), never from the client. Go
   Check-In mirrors this exactly.
4. `apps/api/src/check-in/check-in.service.ts` already implements **every check-in primitive** Go Check-In needs
   (`walkIn`, `appointmentCheckIn` (idempotent), `createCustomer`, `customerSearch`, `waitEstimate`, queue creation,
   duplicate handling) — all gated on a `CheckInContext { tenantId, branchId, userId, role, permissions[] }`. Go Check-In
   reuses these by constructing a **server-derived synthetic kiosk context** from the device's tenant/branch — so all the
   validated, tenant-scoped logic is shared (DRY + safe), and the kiosk never supplies a tenantId.
5. Customers are **per-tenant** (`customers.tenant_id` NOT NULL, with a `normalized_phone` column). There is **no**
   `global_customers` / `central_customers` table (only `global_tech_profiles`). So "central lookup" = a privacy-careful
   cross-tenant search by `normalized_phone` that returns **only** safe minimal fields (first name, last initial, masked
   email) and never other-tenant identity/history. Documented conservatively; linking requires explicit confirm.

## Audit table

| Path | What it does | Layer | Keep/Merge/Fix/Replace | Duplicate? | Mock data? | Tenant-safe? | Missing |
|---|---|---|---|---|---|---|---|
| `check-in/check-in.service.ts` | Front-desk check-in: walk-in, appointment check-in (idempotent), create-customer, customer/appointment search, wait estimate, move-to-queue | backend | **Keep + reuse** via synthetic kiosk ctx | No | No | Yes (`CheckInContext.tenantId`, `this.need(perm)`) | Nothing — reused as-is |
| `check-in/check-in.kysely.repository.ts` | Real Postgres impl of the above (tenant-scoped queries) | backend/db | Keep | No | No | Yes | `customerSearch` is substring, **not phone-normalized** → Go Check-In normalizes before calling |
| `check-in/public-check-in.dto.ts` | Public self check-in kiosk DTOs by slug (lookup/arrived/walk-in/confirmation) + security notes | shared | **Merge** (implement against it) | No | No | n/a (types) | No controller/service — **build** |
| `check-in/check-in.controller.ts` | `@Controller('pos/check-in')`, all `@RequirePermission` (front desk) | backend | Keep (separate from kiosk) | No | No | Yes | — |
| `customer-display/customer-display.service.ts` | Public device flow; `resolveDevice(token)` → `{tenantId, branchId}` via `sha256` hash + `timingSafeEqual`; `issueDeviceToken` returns plaintext once, stores hash | backend | **Keep — mirror the pattern** | No | No | Yes | — |
| `customer-display/customer-display.controller.ts` | Public endpoints, **no** `@RequirePermission`, auth by `x-device-token`/`?deviceToken=` | backend | Keep — pattern for the kiosk controller | No | No | Yes | — |
| `customer-display/customer-display-admin.controller.ts` | Super-Admin device token mint/rotate | backend | Keep — pattern for kiosk device admin | No | No | Yes | — |
| `customer-salons/*` | Cross-tenant salon directory (central customer browsing) | backend | Context for central lookup | No | No | Yes (returns curated public fields) | Not a customer-identity store |
| `customer/*`, `tech/*` notifications | In-app notification read APIs | backend | Unrelated to check-in | No | No | Yes | — |
| `db/migrations/0xx` | 75 migrations; latest **075**; `customers.normalized_phone` present | db | Keep | No | No | Yes | **No `go_checkin_*` tables** → new migration **076** |
| (search) `GoCheckIn` / `go_checkin` / `kiosk` modules | — | — | — | — | — | — | **Do not exist** → build (no duplication risk) |

## Decisions taken from this audit

- **Reuse** `CheckInService` for all actual check-in work (walk-in, appointment arrival, create-customer, wait
  estimate) by passing a synthetic kiosk `CheckInContext` whose `tenantId`/`branchId` come from the device — so the
  kiosk inherits the existing tenant-scoped, dedup-aware logic and **cannot** act on another tenant.
- **Mirror** `customer-display`'s hashed-token resolution for the device/session security model.
- **Implement** the existing `public-check-in.dto.ts` shapes rather than inventing parallel ones.
- **Add** migration `076_go_checkin.sql` for `go_checkin_devices`, `go_checkin_sessions`, `go_checkin_logs`,
  `tenant_checkin_settings`; **reuse** `customers` / `pos_tech_appointments` / check-in records / queue for the rest.
- **Central lookup**: privacy-careful cross-tenant `normalized_phone` search returning only first name + last initial +
  masked email; no history, no other-tenant identity; explicit confirm before linking.
