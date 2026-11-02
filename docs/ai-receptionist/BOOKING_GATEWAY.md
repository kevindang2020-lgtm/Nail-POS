# AI Receptionist — Booking Gateway (Phase 1)

The versioned REST surface Retell custom functions call. It is a thin integration layer over the EXISTING booking
stack — CustomerBookingService's availability engine, BookingService.create/reschedule/cancel (conflict detection,
store-hours validation, notifications, events), CustomersService (dedupe) — behind the existing voice key auth.
There is no second booking system and no AI-only availability math.

## Architecture

Retell agent → custom function (one URL per function) → `POST/GET /api/ai-receptionist/v1/...`
→ `VoiceAuthGuard` resolves the hashed `vk_` key to exactly one tenant + branch (server-derived; nothing in the
request body, query, headers, or Retell arguments can change it) → the existing service performs the action →
a stable `{success, data, meta}` / `{success:false, error:{code, message, retryable, suggestedAction}}` envelope
returns to Retell. The legacy single-URL dispatch endpoint `POST /voice/tool` remains for agents configured that way;
both surfaces share the same services and rules.

## Setup

1. **Issue a key**: Super Admin → AI Receptionist → Integration Keys → Issue. The raw `vk_live_...` value is shown
   once; only its SHA-256 is stored. One key = one tenant + one branch.
2. **Configure Retell**: create the nine custom functions from `retell-functions.json`, base URL = your API origin,
   header `X-Voice-Key: <the key>`. For mutations also send `Idempotency-Key: <Retell tool-invocation id>`.
3. **Env**: set `RETELL_WEBHOOK_SIGNING_KEY` (for the legacy webhook surface), optionally
   `VOICE_VERIFICATION_MODE=phone_name` (default `phone`), and flip `VOICE_WRITE_TOOLS_ENABLED=true` to arm mutations.
   Rate limits: `VOICE_GATEWAY_READ_LIMIT_PER_MIN` (default 240), `VOICE_GATEWAY_WRITE_LIMIT_PER_MIN` (default 60).

## Endpoints

GET `/services` · GET `/hours?startDate&days` · GET `/availability?serviceId&date[&technicianId&limit]` ·
POST `/customers/lookup-or-create` · POST `/appointments` · GET `/appointments/:id?phone[&name]` ·
POST `/appointments/:id/reschedule` · POST `/appointments/:id/cancel` · POST `/handoff`
(all under `/api/ai-receptionist/v1`, all `X-Voice-Key`-authenticated).

Contracts worth calling out: money is **integer cents** (`priceCents`, `priceEstimateCents`) — the platform-wide
invariant; requests use **salon-local** `date` (YYYY-MM-DD) + `startTime` (HH:MM) exactly as `check_availability`
returned them, and responses add ISO timestamps with the branch's real UTC offset (DST-correct via the branch
timezone from store-hours settings). Appointment detail/reschedule/cancel require caller **phone verification** and
operate only on the verified caller's own appointments — anything else reads as `APPOINTMENT_NOT_FOUND`. Customer
creation requires explicit caller **consent** (`consent:true`); ambiguous phone matches return
`CUSTOMER_MATCH_AMBIGUOUS` rather than guessing. The handoff transfer number comes from the branch record only.

## Error codes

`INVALID_API_KEY` 401 · `RATE_LIMIT_EXCEEDED` 429 (+retryAfterSeconds) · `VALIDATION_ERROR` 400 ·
`CONFIRMATION_REQUIRED` 400 · `CUSTOMER_CONSENT_REQUIRED` 400 · `CALLER_VERIFICATION_REQUIRED` 403 ·
`SERVICE_NOT_FOUND`/`CUSTOMER_NOT_FOUND`/`APPOINTMENT_NOT_FOUND` 404 · `SLOT_UNAVAILABLE` 409 (retryable →
CHECK_AVAILABILITY) · `CUSTOMER_MATCH_AMBIGUOUS` 409 · `APPOINTMENT_NOT_MODIFIABLE` 409 · `IDEMPOTENCY_CONFLICT` 409 ·
`IDEMPOTENCY_IN_FLIGHT` 409 (retryable) · `SALON_CLOSED`/`BOOKING_RULE_VIOLATION` 422 · `HUMAN_HANDOFF_REQUIRED` 503 ·
`INTEGRATION_TEMPORARILY_UNAVAILABLE` 503 · `INTERNAL_ERROR` 500 (sanitized — internals never leak).

## Idempotency

Mutations REQUIRE `Idempotency-Key`. Boundary: (tenant, operation, key) in `voice_gateway_idempotency`
(migration 301). First call inserts a pending row — the unique index is the concurrency gate, proven on real
Postgres: two simultaneous identical calls → exactly one proceeds. Commit stores the response; an identical retry
replays it verbatim (`meta.idempotentReplay:true`); the same key with a different payload → `IDEMPOTENCY_CONFLICT`;
a failed request releases its row so a clean retry works. Committed rows are never released.

## Rotation & rollback

Key rotation: issue a new key in the admin screen, switch Retell's header, revoke the old key (two keys can be live
during the switch — revocation is immediate). Rollback: set `VOICE_WRITE_TOOLS_ENABLED=false` — book/reschedule/cancel
and customer-creation return `HUMAN_HANDOFF_REQUIRED` (Retell hands the call to the salon; nothing pretends to
succeed) while reads and `/handoff` stay live. Per-salon disable: revoke that salon's key. Full disable: revoke all
keys or remove the module from `app.module`.

## Honest limitations

The rate limiter is in-process (fixed window per tenant+branch+read/write). Today's deployment is single-instance,
matching the scheduler-lock posture elsewhere in the repo; a multi-instance deployment needs a shared store —
Postgres-based limiting is the natural fit here (there is no platform Redis; the only Redis usage is an optional
ai-insights cache). The repo has no Swagger/OpenAPI tooling, so contracts live in this document and
`retell-functions.json` instead of a generated spec. Multi-service bookings are not exposed in v1 (the gateway books
one service per appointment; the underlying booking screen supports more). Load testing beyond the real-Postgres
concurrency proof needs a deployed environment.
