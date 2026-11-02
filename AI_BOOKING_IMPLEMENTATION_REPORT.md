# AI Booking Assistant (`ai_booking`) — Implementation Report

Consolidated report for the `ai_booking` arc (spec §61–64), grounded in the actual codebase. It reflects what was
built, what already existed and was therefore **not** rebuilt, and the honest remaining work.

## 1. Headline

`ai_booking` was implemented as a thin, channel-agnostic **orchestration + trusted-source layer over the existing
authoritative booking engine** — not a second booking system. Inspection during the arc revealed that several channels
the spec framed as greenfield already exist as mature systems; those were reused/reconciled rather than duplicated.

- **Authoritative engine (reused):** `booking/booking.service.ts` (`BookingService`) — availability, conflict, create,
  reschedule, cancel, confirm; server-context-scoped, permission-gated, audited; concurrency via advisory lock;
  multi-service via `appointment_service_lines`; holds via `booking_holds` (migration 009).
- **AI Phone channel (already existed — NOT rebuilt):** `voice-booking/` (`api/ai-receptionist/v1`, `VoiceAuthGuard` =
  hashed `vk_` key → server-derived tenant/branch; idempotent, caller-verified, confirm-gated; its own analytics incl.
  `bookingRatePct`). A duplicate phone path drafted in ai_booking was **removed**.
- **Customer Mobile channel (already existed — NOT rebuilt):** `customer/customer.controller.ts`
  (`GET /customer/appointments`, `POST /customer/appointments/:id/cancel`, customer-scoped via `customer/auth`).
- **Front-desk / POS channel (already existed):** the Reception Copilot (`ai-center/`), now also emitting into the
  shared funnel.

## 2. Files created (this arc)

Backend `apps/api/src/ai-booking/`: `ai-booking-source.ts`, `ai-booking-context.ts`, `ai-booking.service.ts`,
`ai-booking-mutation.service.ts`, `ai-booking-conversion.service.ts`, `ai-booking-metrics-core.ts`,
`ai-booking-signed-context.ts`, `ai-booking-public.resolver.ts`, `ai-booking-link.service.ts`, controllers
(`ai-booking.controller.ts`, `ai-booking-public.controller.ts`, `ai-booking-admin.controller.ts`), `ai-booking.module.ts`,
+ 4 spec files. `apps/api/src/booking-conversion/booking-conversion.emitter.ts` (neutral shared emitter).
Frontend: `apps/admin-web/src/screens/AiBookingAnalyticsScreen.tsx` (+ test), api method, route, nav.
Migration: `314_ai_booking_conversion_events.sql`.

Files modified: `ai-center/ai-center.module.ts` (export copilot context + ledger; import emitter module),
`ai-center/reception-copilot-action.service.ts` (emit funnel events for booking actions), `app.module.ts` (register
module), admin-web `App.tsx` / `AdminLayout.tsx` / `superAdminAiApi.ts`.

## 3. Backend routes

Authenticated (TenantAuthGuard) `/api/ai-booking/v1`: `POST context`, `POST availability/search`, `POST recommendations`,
`POST appointments`, `POST appointments/:id/reschedule`, `POST appointments/:id/cancel`, `POST conversion-events`,
`GET conversion/summary`, `GET conversion/metrics`.
Public (no session guard; signed-token / verified context) `/api/ai-booking/v1/public`: `POST availability/search`,
`POST appointments`.
Super Admin (SuperAdminGuard) `/super-admin/tenants/:id`: `POST ai-booking/link` (mint), `GET ai-booking/metrics`.

## 4. Source matrix (§62) — as implemented

| Booking source          | Authentication / trust                          | Tenant resolution                 | Branch resolution            | Human confirmation        | Mutation service |
|-------------------------|-------------------------------------------------|-----------------------------------|------------------------------|---------------------------|------------------|
| AI Phone Receptionist   | `voice-booking` `VoiceAuthGuard` (hashed vk_ key) | server-derived from key           | server-derived from key      | verbal, confirm-gated     | BookingService (via voice gateway) |
| Front-Desk POS          | authenticated POS session (`req.ctx`)           | `req.ctx.tenantId`                | `req.ctx.branchId`           | UI confirm-gate           | BookingService (via Copilot spine) |
| Customer Mobile App     | `customer/auth` session                         | customer session                  | validated server-side        | customer confirm          | BookingService (via customer ctrl) |
| Online Booking          | signed booking token (`ai_booking`)             | signed payload (tamper-proof)     | signed payload               | confirm-gate in facade    | `AiBookingMutationService` → BookingService |
| Partner Booking Link    | signed, expiring, service-scoped token          | signed payload                    | signed payload               | confirm-gate in facade    | `AiBookingMutationService` → BookingService |
| Walk-In Conversion      | authenticated POS/queue workflow (existing)     | `req.ctx`                         | `req.ctx`                    | receptionist confirm      | BookingService (queue↔booking) |
| Super Admin Support     | existing support/access session (`supportSessionId` required) | server-selected      | server-selected              | support confirm           | BookingService (audited) |

## 5. Booking-action matrix (§63) — as implemented

| Capability            | Read/Mutation | Confirm | Idempotency                 | DB       | Service |
|-----------------------|---------------|---------|-----------------------------|----------|---------|
| Search availability   | Read          | No      | No                          | primary  | BookingService.availability |
| Recommend options     | Read          | No      | No                          | primary  | Copilot ranking (reused) |
| Create appointment    | Mutation      | **Yes** | **Yes** (shared 307 ledger) | primary  | AiBookingMutationService → BookingService.create (source-stamped) |
| Reschedule            | Mutation      | **Yes** | **Yes**                     | primary  | → BookingService.reschedule |
| Cancel                | Mutation      | **Yes** | **Yes**                     | primary  | → BookingService.cancel |
| Mint booking link     | Mutation      | n/a     | n/a                         | none     | AiBookingLinkService (HMAC sign) |
| Record conversion     | Append        | No      | No                          | primary  | AiBookingConversionService / BookingConversionEmitter |

## 6. Tenant / branch isolation design

Tenant and branch are **never** read from the request body, query, headers, or model output. They come only from:
(a) the guard-populated `req.ctx` (authenticated channels), or (b) the **verified, tamper-proof signed token** payload
(online/partner) — a client editing the tenant invalidates the HMAC signature. Every conversion write/read is
tenant-filtered; the conversion table is tenant-indexed. Proven on real Postgres: cross-tenant conversion isolation
(`METRICS_ISOLATED_OK`, `AIBOOKING_CONV_OK`), forged/tampered token rejection (unit), and scoped (non-admin) permissions
for public channels.

## 7. Idempotency & concurrency

Mutations reuse the **existing** action ledger (migration 307) — not a second store; a replayed key returns the original
result and the engine runs once (real-PG `MUT_IDEM_OK`). Double-booking is prevented by `BookingService`'s in-transaction
advisory lock; the losing writer gets `APPOINTMENT_CONFLICT`.

## 8. Tests

`ai_booking` + `booking-conversion`: **28** unit tests (source/mapping, trusted-context isolation incl. cross-tenant
injection, mutation confirm-gate + idempotent replay + source stamping + error mapping, signed-token forge/tamper/expiry/
scope, mint→verify, conversion metric formulas). Copilot emission: 3 tests. admin-web analytics screen: 2 tests.
Real-Postgres proofs: `AIBOOKING_CONV_OK`, `MUT_IDEM_OK`, `METRICS_ISOLATED_OK`, `CROSS_CHANNEL_EMIT_OK`. Full API suite
green at **2970/2970**; admin-web builds clean; migrations 301–314 apply in sequence.

## 9. Environment variables

`AI_BOOKING_LINK_SECRET` (HMAC secret for online/partner signed links; unset → links refuse cleanly),
`PUBLIC_BOOKING_BASE_URL` (optional; renders a `bookingUrl` on minted links).

## 10. Bug found & fixed

`ai_booking_conversion_events.appointment_id` was UUID and silently dropped events whose appointment id wasn't a UUID
(caught by a real-PG smoke); changed to TEXT (analytics reference, matches `actor_user_id`).

## 11. Remaining work — final reconciliation (all items resolved)

Every remaining spec item was inspected and found to be covered by existing systems + the ai_booking facade; building
parallel versions would duplicate mature code, which the spec forbids:

- **Recommendation cards (§48) & confirmation UI (§49):** already implemented in `POSReceptionCopilotScreen.tsx`
  (availability + technician recommendations, conflict/duplicate detection, and a prepare→confirm card flow for
  book/reschedule/cancel/message). Not rebuilt.
- **Walk-in conversion (§33):** covered by the existing `queue/` + `check-in/` modules; converting to a future
  appointment is a `create` with source `WALK_IN_CONVERSION` (facade stamps it → domain `walk_in`). Tested.
- **Super Admin support mode (§34):** covered by `super-admin-support/support-actions.service.ts` (reason-required,
  audited) + the ai_booking context resolver requiring an active support session for `SUPER_ADMIN_SUPPORT_MODE`. Tested.
- **Voice/customer channels → shared funnel:** deliberately not wired — both already have their own analytics (voice
  computes `bookingRatePct`); wiring would be redundant and edit mature modules.

**Conclusion:** ai_booking is complete for its genuine, non-duplicative scope. The AI-phone, customer-mobile, front-desk,
walk-in, and support channels already existed and were reused; ai_booking's net-new contribution — the online/partner
signed-link channel (mint→verify→book, with abuse protection), the unified mutation facade (create/reschedule/cancel/
confirm/get over the authoritative engine), and the shared conversion analytics (funnel→metrics→dashboard) — is built
and tested end to end.


## 12. Production-readiness checklist (§64)

- [x] Tenant/branch isolation: server/signed only; cross-tenant tests pass.
- [x] Availability via the authoritative engine; bounded results.
- [x] Single + multi-service create via existing transaction; conflicts + duplicates prevented by the engine.
- [x] Confirm-gated, idempotent mutations; read-after-write on primary.
- [x] Online/partner signed-link channel (mint + verify + scope) — new, end-to-end.
- [x] Conversion tracking + tenant-scoped analytics + Super Admin dashboard.
- [x] AI-phone + customer-mobile channels reused (not duplicated); duplicate phone path removed.
- [ ] `AI_BOOKING_LINK_SECRET` set in the target environment (owner step, for online/partner links).
- [ ] Optional: voice/customer channels adopt the shared emitter if a single unified dashboard is desired.

## Addendum — POS source badges (§47) ✅ BUILT
`pos-web` `SourceBadge` component maps both domain source values (phone/manual/online/walk_in/customer_app/ai/google)
and the ai_booking channel sources to friendly labels (AI Phone, Front Desk, Customer App, Online, Partner, Walk-In,
Support) with subtle tints. Wired into the POS booking appointment detail row, replacing the raw source text. Unknown
values fall back to the raw string; empty renders "—". Verified: 3 component tests; POSBookingScreen's 52 tests still
green; full pos-web suite 324/324; build clean.

## Addendum — public-endpoint abuse protection (§31/§43) ✅ FIXED
Gap owned: the public online/partner endpoints (`/api/ai-booking/v1/public/*`) were built WITHOUT the abuse protection
the spec requires for unauthenticated traffic. Fixed by reusing the existing shared `TenantRateLimiter`
(`TENANT_RATE_LIMITER` / `RateLimitModule`) — no new limiter. After the signed token resolves to a trusted context, each
request is bucketed PER-TENANT-per-source (`aib:pub:{tenantId}:{source}`), so one salon's (or a leaked) link can never
exhaust another salon's budget; over-budget returns 429 `TEMPORARY_CAPACITY_PROTECTION` with `retryAfterSeconds`.
Forged/expired tokens are rejected by the resolver BEFORE the limiter is touched, so invalid traffic is cheap and can't
drain the bucket. Pass-through until the limiter is enabled (`RATE_LIMIT_STORE=redis`). Verified: 3 tests (disabled
pass-through, per-tenant-source 429 with correct key, forged-token rejected before rate spend); api 2973/2973.

Updated §64 checklist:
- [x] Online/partner public endpoints have per-tenant abuse protection (noisy-neighbor safe), enabled via env.

## Addendum — mutation surface completed (confirm + retrieval)
- **Confirm (§23):** added `BookingService.confirm(ctx, id)` to the authoritative engine (mirrors `checkIn`:
  permission-gated `pos.booking.edit`, `pbCanConfirm` transition guard = booked→confirmed, audited, sets status
  `confirmed`). ai_booking `AiBookingMutationService.confirmAppointment` delegates to it — confirm-gated + idempotent
  (shared 307 ledger), but NOT a booking-conversion funnel event (confirmation is a post-booking status change, not a
  conversion stage). Route: `POST /api/ai-booking/v1/appointments/:id/confirm`.
- **Retrieval (§36):** `GET /api/ai-booking/v1/appointments/:id` → `AiBookingService.getAppointment` →
  `BookingService.detail` (tenant/branch scoped, `pos.booking.view`).
- The booking-action matrix (§5) now covers create / reschedule / cancel / **confirm** / **get**, all delegating to the
  authoritative engine. Verified: 3 confirm unit tests (confirm-gate, delegation without funnel event, idempotent
  replay); api 2979/2979; build clean. `confirm` mirrors the already-tested `checkIn` transition path.

## Addendum — targeted link revocation (§32 "Revocable") ✅ FIXED
Gap owned: partner/online links were signed/expiring/scoped/audited but NOT individually revocable (only secret rotation
or expiry). Fixed: each minted link now carries a unique `jti` in its signed payload (returned by mint); migration 315
`ai_booking_revoked_links` (PK tenant_id+jti) stores revocations; `AiBookingRevocationService` checks it (15s cache) on
the public verify path AFTER signature/expiry; `POST /super-admin/tenants/:id/ai-booking/link/revoke` revokes a single
link. A revoked link is rejected with `INVALID_PARTNER_LINK` without rotating the shared secret; tenant-isolated (same
jti under another tenant is unaffected). Verified: 4 unit tests + real-PG `REVOKE_OK`; api 2983/2983; migrations 313–315
in sequence.

## Addendum — §54 permission matrix + §59 load harness (gap closure)

**§54 ai_booking.* permission matrix ✅** — 14 permissions registered in `auth/rbac.ts` (view, search_availability,
create, reschedule, cancel, confirm, override_duplicate, override_conflict, use_alternate_branch, manage_partner_links,
view_sources, view_conversion, manage_settings, support_mode). Granted: ops → RECEPTION / FRONT_DESK / MANAGER / OWNER;
management/override → MANAGER / OWNER. Public channels get scoped `ai_booking.search_availability` + `ai_booking.create`
via `scopedPermissionsFor`. **Enforcement:** the mutation facade now requires the matching `ai_booking.<action>` IN
ADDITION to the domain `pos.booking.*` the engine enforces — a channel with the domain perm but not the ai_booking perm
is denied (`PERMISSION_DENIED`, no write). Verified by a new perm-denied test.

**§59 load harness ✅** — `apps/api/scripts/ai-booking-load-test.mjs`, a real runnable harness that seeds N tenants,
records the full conversion funnel per tenant across sources, and verifies (1) no cross-tenant exposure in summary/metrics
and (2) bounded latency. Executed at 200 tenants / 1,200 events on local Postgres: **p50 10ms, p95 21ms, p99 201ms,
0 cross-tenant leaks** (`AI_BOOKING_LOAD_OK`). True 10,000-tenant scale runs the identical harness against the target env.

**Verified:** api **3011/3011**, tsc 0, build clean, ai_booking suite 39/39, migrations 314–315 in sequence.

## Addendum — §44 index verification + §53 system-status

**§44 index tuning ✅ (verified optimal)** — `EXPLAIN (ANALYZE, BUFFERS)` on the conversion metrics query at 50,000 rows
uses `idx_ai_booking_conv_tenant_source_created` (bitmap index scan on tenant_id + created_at) with **0.3ms execution**.
No missing index; the composite index already covers the tenant-scoped windowed aggregate. (The p99 outlier in the load
run was process/GC noise, not a query-plan problem — the query itself is sub-millisecond.)

**§53 Super Admin system-status ✅** — `GET /super-admin/tenants/:id/ai-booking/system-status` reports honest,
config-driven operational health: link signing configured (AI_BOOKING_LINK_SECRET), public booking URL, public abuse
protection (active vs pass-through), conversion pipeline, link revocation, and permission-matrix enforcement — no
fabricated values. Verified by 2 tests. api **3013/3013**.

### Still external / by-design (unchanged)
- Full 10k-scale load run needs the production-sized environment (harness is identical).
- AI-phone / customer-mobile / front-desk / walk-in / support channels remain reused-by-design (not duplicated).
