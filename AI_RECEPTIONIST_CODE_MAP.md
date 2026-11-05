# AI Receptionist — Code Map (Phase 0)

Inspection of the real AIPowerSalon repo to map what the voice receptionist will REUSE. The strongest architecture (per
your summary and confirmed by the code) is a thin secured Voice Booking Gateway over existing services — NOT a second
booking system. Note: the referenced `AIPowerSalon-AI_RECEPTIONIST_PLAN.md` was not in the upload; this map is derived
from the actual code plus your summary.

## Canonical services to REUSE (do not duplicate)
| Capability | Existing service (source of truth) | Key methods |
|---|---|---|
| Availability (real slot calc) | `apps/api/src/customer-booking/customer-booking.service.ts` + `availability.ts` | `availability(ctx, {serviceId,date,technicianId})` → `computeAvailableSlots(...)` — the SAME conflict gate as staff booking |
| Create appointment | same `CustomerBookingService` | `book(ctx, CreateBookingRequest)` → typed 400/403/409 errors |
| Reschedule | same | `reschedule(ctx, apptId, body)` → **atomic** `rescheduleAtomic(...)` (does NOT cancel-then-book — matches spec Phase 10) |
| Booking options (services/techs for booking) | same | `getOptions(ctx)` |
| Staff booking / day-grid | `apps/api/src/booking/booking.service.ts` | canonical BookingService (staff side) |
| Customer lookup/create | `apps/api/src/customers/customers.service.ts` | `create(ctx, req)` with duplicate flagging; phone normalization helpers (`normalizeImportPhone`) |
| Services catalog | `apps/api/src/services/services.service.ts` | list/categories (already cached) |
| Technicians | `apps/api/src/technicians/technicians.service.ts` | roster + service eligibility + schedule |
| Business hours | branch/settings modules | hours, holidays, special hours |
| Notifications | `apps/api/src/notifications/notifications.service.ts` | reuse; never claim delivery until it reports success |
| Audit (append-only) | `apps/api/src/audit/audit.service.ts` | `audit.push({...})` — append-only, read-only logs |
| Handoff / follow-up task | `queue`, `super-admin-support`, `end-of-day-followups` | create reception task / callback |
| **Integration-key auth model (Phase 2)** | `apps/api/src/api-webhooks/*` | hashed keys (`sha256`), tenant-scoped, `ApiKeyStatus = active/expired/revoked`, rotate/revoke/last-used — the exact model to mirror for voice keys |

## Server-derived identity (security invariant — already correct)
`CustomerBookingContext { tenantId, branchId, userId }` is server-derived. The voice gateway will resolve
tenant+branch **from the integration key**, never from the caller/provider — satisfying "AI must not choose tenantId".

## What does NOT exist yet (net-new)
- **No voice/telephony module** — only `ai`, `ai-center`, `ai-governance`, `ai-revenue` exist. No Twilio/Retell/Vapi/
  ElevenLabs config. So the Voice Booking Gateway, the voice-integration-key store, the provider port, the call-session/
  outcome store, the learning pipeline, and the config/history UI are all net-new.
- No `/voice/*` routes.

## Reuse verdict
Every booking/customer/schedule/notify/audit/handoff capability the spec needs already exists and is production-tested.
The receptionist is almost entirely a thin secured adapter + a provider layer + storage for call outcomes/learning — no
duplication of booking logic required.
