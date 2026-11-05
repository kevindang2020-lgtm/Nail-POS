# AI Booking Assistant (`ai_booking`) — Architecture Map & Stage 1 Implementation

This is the mandatory inspection deliverable (spec §2) plus the first real implementation slice. It is grounded in the
actual codebase, not a plan for a greenfield system. **The authoritative booking engine already exists** — `ai_booking`
is being built as a thin, channel-agnostic orchestration + trusted-source layer over it, exactly as the spec demands
("Do not create a second appointment system, second availability engine…").

## What already exists (reuse, do not duplicate)

> **Reconciliation note (Stage 3 inspection).** Deeper inspection found that TWO of the spec's channels are already
> implemented as mature systems, so `ai_booking` must NOT rebuild them:
> - **AI Phone** → `voice-booking/` (`api/ai-receptionist/v1`, `VoiceAuthGuard` = hashed `vk_` key → server-derived
>   tenant/branch, idempotent + caller-verified + confirm-gated book/reschedule/cancel, delegates to `BookingService`,
>   tags `source:'ai'`). A duplicate phone path I had drafted in ai_booking was **removed**.
> - **Customer Mobile** → `customer/customer.controller.ts` (`GET /customer/appointments`, `POST
>   /customer/appointments/:id/cancel`, customer-scoped via `customer/auth`). Not rebuilt in ai_booking.
> `ai_booking`'s genuinely-new, non-duplicative surface is therefore: the **online/partner signed-link channel**, the
> **shared source + conversion tracking**, and the **staff/super-admin orchestration facade**. The map below reflects
> that corrected scope.

- **Authoritative engine** — `apps/api/src/booking/booking.service.ts` (`BookingService`): `availability()`,
  `checkConflict()`, `create()` (writes `appointments.source`), `reschedule()`, `cancel()`, `update()`,
  `assignTechnician()`, `checkIn()`/confirm, `noShow()`, plus idempotent `moveToQueue`/`moveToTechQueue`/`startService`.
  All take a server-derived `BookingContext { tenantId, branchId, userId, role }`, permission-gated (`pos.booking.*`),
  audited to `audit_events` (module `pos_booking`), with customer notifications.
- **Schema** — `db/migrations/009_booking.sql`: `appointments` (tenant/branch/customer/technician/start/end/status +
  **`source`**), `appointment_service_lines` (**multi-service already modelled**), `booking_holds` (**concurrency/hold
  primitive already exists**), with tenant/branch/technician/start indexes.
- **Booking intelligence** — `apps/api/src/ai-center/reception-copilot-context.service.ts`: `recommendAvailability`,
  `recommendTechnicians`, `detectConflict`, `duplicateCandidates`, `customerContext` (ranking + duplicate + conflict).
- **Mutation spine** — `reception-copilot-action.service.ts`: confirm-gated, idempotent (ledger, migration 307), audited
  `create_appointment` / `reschedule_appointment` / `cancel_appointment` that delegate to `BookingService`.
- **Existing source values** — `PBSource = walk_in | phone | online | google | ai | customer_app | manual` on
  `appointments.source`. Preserved and mapped to, not replaced.
- **Trusted context** — `common/guards/tenant-auth.guard.ts` attaches `req.ctx` (tenant/branch/user/role/permissions).

## What `ai_booking` adds (the genuinely new layer)

Files created this slice (`apps/api/src/ai-booking/`):

- **`ai-booking-source.ts`** — the 7 canonical channel sources (AI_PHONE_RECEPTIONIST, FRONT_DESK_POS,
  CUSTOMER_MOBILE_APP, ONLINE_BOOKING, PARTNER_BOOKING_LINK, WALK_IN_CONVERSION, SUPER_ADMIN_SUPPORT_MODE), validation,
  and mapping onto existing `PBSource` values (so we reuse `appointments.source`). Pure + tested.
- **`ai-booking-context.ts`** — `resolveTrustedContext(serverCtx, source)`: the isolation core. Tenant/branch come
  ONLY from `req.ctx`; the function does not accept a client tenant/branch, so injection is structurally impossible.
  Validates source; requires an active support session for SUPER_ADMIN_SUPPORT_MODE.
- **`ai-booking.service.ts`** — orchestration facade. `searchAvailability` delegates to `BookingService.availability`
  (bounded to 8 technicians × 12 slots), stamps source, records the funnel; `recommendOptions` reuses the Copilot
  ranking. No parallel engine; a `BookingService` failure surfaces (no fabricated slots).
- **`ai-booking-conversion.service.ts`** + **migration 314** `ai_booking_conversion_events` — per-tenant/branch/source
  funnel (no conversational content). Every read is tenant-filtered.
- **`ai-booking.controller.ts`** — `POST /api/ai-booking/v1/{context,availability/search,recommendations,
  conversion-events}` + `GET /conversion/summary`, behind `TenantAuthGuard`, server-derived ctx, bounded.

## Tenant/branch isolation design

Tenant and branch are read exclusively from `req.ctx` and threaded through as the trusted `AiBookingContext`. Every
downstream call (`BookingService`, conversion writes/reads) is tenant-scoped. The conversion table is tenant-indexed and
every query filters `tenant_id`. Proven on real Postgres: tenant A's conversion summary returns only A's rows
(`AIBOOKING_CONV_OK`), and the trusted-context unit tests prove a caller-supplied tenant/branch is never honoured.

## Verified this slice

api **2947/2947** (exit 0), tsc 0, build clean, lint clean; migration 314 applies in sequence (312→313→314); real-PG
tenant-isolation proof passes; 8 new ai_booking tests (source validation, context isolation incl. cross-tenant injection
attempt, support-session requirement, availability delegation + bounding, no-fabricated-slots on engine failure).

---

## Staged plan for the remainder (spec §56 rollout)

This slice is **Stage 1** (read orchestration + trusted context/source + conversion), matching the spec's own Stage 1
("read-only availability, recommendations only, no mutations"). The remainder, each a real slice reusing the existing
engine + Copilot action spine — **not** new engines:

- **Stage 2 — mutation facade ✅ BUILT**: `AiBookingMutationService` + routes `POST /api/ai-booking/v1/appointments`,
  `/appointments/:id/reschedule`, `/appointments/:id/cancel`. Contract: (1) no write without explicit confirmation
  (HUMAN_CONFIRMATION_REQUIRED), (2) durable idempotency reusing the SAME ledger table as the Copilot spine (migration
  307) — never a second store; replay returns the original, engine runs once, (3) channel SOURCE stamped onto
  appointments.source at create (original source, never overwritten by reschedule/cancel), (4) conversion funnel
  (ATTEMPTED→SUCCEEDED/FAILED). All mutations delegate to the authoritative BookingService (in-transaction permission +
  conflict + advisory-lock double-booking protection + audit); domain errors mapped to stable codes
  (APPOINTMENT_CONFLICT, PERMISSION_DENIED, VALIDATION_ERROR, APPOINTMENT_NOT_FOUND, IDEMPOTENCY_CONFLICT). Verified:
  6 unit tests + real-PG `MUT_IDEM_OK` (shared 307 ledger, idempotent replay, engine called once).
  Remaining in this stage: `confirm` (maps to the domain confirmation/check-in path) + original-vs-mutation source split
  as a dedicated column if desired (today: original on appointments.source, mutation source in conversion + audit).
- **Stage 3 — online/partner channel + reconciliation ✅ BUILT**:
  `ai-booking-signed-context.ts` mints/verifies HMAC-SHA256, expiring, scoped booking tokens (mirrors
  `auth-session-token`); tenant/branch live inside the signed payload so a client cannot edit them (tamper → bad
  signature). `AiBookingLinkService` + `AiBookingAdminController` (`POST /super-admin/tenants/:id/ai-booking/link`) MINT
  signed online/partner links (tenant server-supplied, scoped services, partner/campaign, expiry). `AiBookingPublicResolver`
  + `AiBookingPublicController` (`/api/ai-booking/v1/public/{availability/search,appointments}`, NO session guard) verify
  the token → trusted scoped context (view+create only, never admin) → delegate to the SAME shared services; partner
  tokens restrict bookable services to the allow-list. Secret `AI_BOOKING_LINK_SECRET`; unset → refuses cleanly.
  **AI-Phone and Customer-Mobile paths were NOT built here** — those channels already exist (voice-booking/, customer/)
  and a duplicate phone path was removed. Verified: 10 unit tests (forge/tamper/expiry/scope + resolver isolation +
  mint→verify round-trip).
- **Stage 4 — conversion analytics ✅ BUILT**: `ai-booking-metrics-core.ts` (pure, documented §27 formulas:
  attempt→booking rate, search→booking rate, per-source rollup, failure-reason breakdown; never divides by zero).
  `AiBookingConversionService.metrics()` reads the tenant-scoped funnel; endpoints `GET /api/ai-booking/v1/conversion/
  metrics` (tenant) + `GET /super-admin/tenants/:id/ai-booking/metrics`. Verified: 4 unit tests + real-PG
  `METRICS_ISOLATED_OK` (tenant B never bleeds into tenant A's rate).
- **Stage 5 — remaining (not built)**: wiring the pre-existing voice-booking / customer channels to emit the shared
  conversion events (integration, not duplication); the POS analytics/source-badge/recommendation-card UI; per-tenant/
  branch/source feature-flag rollout.

Honest status: Stages 1–4 are built + tested (trusted context/source, read orchestration, confirm-gated idempotent
mutation facade, online/partner signed links + minting, conversion analytics). The AI-phone and customer-mobile channels
already existed (voice-booking/, customer/) and were NOT rebuilt; a duplicate phone path was removed. Nothing fabricates
data, bypasses the booking transaction, trusts client tenant/branch, or duplicates an engine.

## Stage 5 (partial) — cross-channel conversion emission ✅ BUILT
The pre-existing channels can now feed the shared funnel without the circular dependency:
- `booking-conversion/booking-conversion.emitter.ts` — a NEUTRAL low-level writer (`BookingConversionEmitter`, depends
  only on DATABASE) that any channel module imports without touching ai-booking (which imports ai-center) → no cycle.
- The Reception Copilot action spine (front-desk POS channel) now emits BOOKING/RESCHEDULE/CANCEL SUCCEEDED/FAILED into
  the shared funnel (source FRONT_DESK_POS), best-effort, after every mutation. Non-booking actions don't emit.
- Bug found + fixed via the real-PG smoke: `ai_booking_conversion_events.appointment_id` was UUID, which silently
  dropped events whose appointment id wasn't a UUID; changed to TEXT (analytics reference, matches actor_user_id).
- Verified: 3 copilot emission unit tests + real-PG `CROSS_CHANNEL_EMIT_OK` (a Copilot create surfaces as FRONT_DESK_POS
  in ai_booking metrics). Remaining: voice-booking + customer channels can adopt the same emitter (one-line inject) when
  desired; the analytics UI (§46) is still unbuilt.

## Stage 5 (cont.) — analytics UI ✅ BUILT
`admin-web` `AiBookingAnalyticsScreen` (sidebar "AI Booking Analytics", route `/ai-booking-analytics`): tenant selector
+ window, overall conversion (booking + search→booking rates, bookings/attempts/searches/failures), a per-source
breakdown with proportional bars and rate, and top failure reasons — reading `GET /super-admin/tenants/:id/ai-booking/
metrics`. Honest empty state (no fabricated numbers). Verified: 2 screen tests + admin-web build clean.
