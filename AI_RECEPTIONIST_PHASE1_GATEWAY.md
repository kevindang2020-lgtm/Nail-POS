# AI Receptionist Phase 1 — Retell Booking Gateway (delivered 2026-07-04)

Premise correction first: the pasted spec assumed "the actual implementation has not yet been built." Most of it was —
key auth, tenant/branch derivation, the availability/booking/manage services, verification, consent gating, the admin
key screen. This phase built the genuine delta and is now complete: the **nine versioned REST endpoints** Retell
custom functions call, **Idempotency-Key protection on mutations** (the real gap — Retell retries could previously
double-book), a **business-hours endpoint**, the **{success,data,meta} envelope + stable error taxonomy**, a
**handoff endpoint with a server-derived transfer destination**, **per-key rate limiting**, and the **Retell function
schemas + integration doc**. The legacy `POST /voice/tool` dispatch surface remains; both share the same services.

## Endpoint report (spec §40)

| Function | Method | Route (`/api/ai-receptionist/v1`) | Auth scope | Idempotency | Existing service used |
|---|---|---|---|---|---|
| Get services | GET | `/services` | vk_ key → tenant+branch (VoiceAuthGuard) | No | VoiceBookingService → CustomerBookingService |
| Get hours | GET | `/hours` | same | No | VoiceBranchInfoService (tenant_settings `store_hours` over DEFAULT_SETTINGS) |
| Check availability | GET | `/availability` | same | No | VoiceBookingService → CustomerBookingService availability engine |
| Lookup/create customer | POST | `/customers/lookup-or-create` | same | Yes | VoiceManageService → CustomersService (consent-gated create, ambiguity-safe) |
| Book appointment | POST | `/appointments` | same | Yes (required) | VoiceBookingWriteService → BookingService.create (conflict + hours rules) |
| Get appointment | GET | `/appointments/:id` | same + caller phone verification | No | VoiceManageService → BookingService.detail (masked, own-only) |
| Reschedule | POST | `/appointments/:id/reschedule` | same + verification | Yes (required) | VoiceManageService → BookingService.reschedule (atomic) |
| Cancel | POST | `/appointments/:id/cancel` | same + verification | Yes (required) | VoiceManageService → BookingService.cancel (history preserved) |
| Human handoff | POST | `/handoff` | same | Yes | VoiceBranchInfoService (branches.phone) + VoiceCallOutcomeService |

## What was added (files)

- `db/migrations/301_voice_gateway_idempotency.sql` — idempotency ledger; unique (tenant, operation, key) is the
  concurrency gate. Applied to real Postgres.
- `src/voice-booking/voice-gateway-core.ts` — envelope, 19-code error taxonomy with HTTP statuses/retryable/
  suggestedAction, sanitize-on-unknown mapping, canonical payload hashing, DST-correct branch-timezone ISO
  (`isoAt`), fixed-window rate limiter.
- `src/voice-booking/voice-idempotency.service.ts` — begin/commit/release semantics (replay identical retries,
  conflict on changed payload, release-on-failure) with Kysely + in-memory repos; `VoiceBranchInfoService` — narrow
  least-privilege reads of the branch transfer phone and store hours (deliberately NOT PosSettingsService, whose
  role+`settings.view` gate would over-scope the AI principal per spec §3.3).
- `src/voice-booking/ai-receptionist-gateway.controller.ts` — the nine endpoints; mutations are confirm-gated,
  verification-gated where they touch a customer's appointment, rate-limited, and dark behind
  `VOICE_WRITE_TOOLS_ENABLED` (returning HUMAN_HANDOFF_REQUIRED — never fake success).
- `voice-manage.service.ts` — lookup now returns safe customer fields + matchType and flags ambiguous matches;
  new `getOwnAppointment` (masked, own-only) and `customerContact`; `voice-booking-write.service.ts` passes
  `customerId` through to the booking create.
- `docs/ai-receptionist/retell-functions.json` (nine function definitions with behavioral guardrails: confirm before
  book, never claim success pre-response, consent before create, offer 2-3 slots) and
  `docs/ai-receptionist/BOOKING_GATEWAY.md` (setup, key provisioning/rotation, error table, idempotency, rollback).

## Verification (all fresh)

Real Postgres: migration 301 applies; **two concurrent identical begins → exactly one proceeds**; committed replay
returns the stored response; committed rows survive release. Gateway suite: **19/19** (envelope, taxonomy, sanitized
internals, idempotency required/replay/conflict/release-then-retry, retried book creates the appointment ONCE,
writes-dark → HUMAN_HANDOFF_REQUIRED, confirmation gate, verification gate, cross-customer reads as not-found,
server-derived handoff + callback fallback, DST offsets, Sunday-closed hours, limiter window). Voice modules:
**114/114 across 12 files**. Full api suite: **2716/2716 across 426 files**, `tsc` 0, build clean, lint clean.

## Deliberate deviations from the pasted spec (with reasons)

Money is **integer cents**, not dollar floats — platform invariant. Customer creation is **consent-gated** — your
standing rule; the generic spec omitted it. Appointment detail is **verification-gated** (stricter than §13's
minimum) — consistent with the reschedule/cancel model already approved. Bookings are **single-service** in v1 —
the spec allows this ("only if the existing system supports them safely"; exposing multi-service adds contract
surface Retell doesn't need yet). Requests use **salon-local date+startTime** rather than ISO `startAt` — it matches
the availability engine's contract exactly and avoids double-timezone ambiguity; responses return offset ISO. The
rate limiter is **in-process** (no platform Redis exists — the spec's "reuse existing Redis throttling" has no
referent; single-instance today, documented). **No OpenAPI** — the repo has no Swagger tooling; contracts live in
the docs. Load tests beyond the real-PG concurrency proof need a deployed environment. No new notification paths —
mutations flow through BookingService, which already owns notifications/events (no duplicates, per §30).

## Go-live (next phase, needs your accounts)

Create the Retell agent + Twilio number → issue a `vk_live_` key in Super Admin → AI Receptionist → configure the
nine functions from `retell-functions.json` with `X-Voice-Key` (+ `Idempotency-Key` on mutations) → set
`RETELL_WEBHOOK_SIGNING_KEY`, optionally `VOICE_VERIFICATION_MODE=phone_name` → arm `VOICE_WRITE_TOOLS_ENABLED=true`
→ pilot one salon with the admin Calls/Analytics panels watching. Rollback is one env flip.

## Addendum — end-to-end simulation + agent prompt (2026-07-04, second pass)

Added `ai-receptionist-gateway.e2e.vitest.spec.ts`: the §33 Retell simulation run through the REAL service graph —
the gateway controller over the real CustomerBookingService availability math, the real BookingService conflict
engine and status machine, and the real CustomersService, with the availability data port wrapping the SAME
repository instance the write path mutates (booked slots genuinely disappear from availability). **11/11 passing**,
mapped to the §42 exit criteria: real services with integer cents (1); real availability excluding seeded busy times
(3); consent-gated customer creation with dedupe — same phone finds the same person (4); a real booking that a
duplicate Retell call replays instead of re-creating, with exactly one row on the day (5, 11); the appointment
visible to the same detail path the Booking screen reads and gone from availability (6-equivalent); verified,
phone-masked retrieval with an unverified caller refused (7); atomic reschedule — moved, not duplicated (8); cancel
with a safe repeated call, preserved history (status model, record kept), and canReschedule/canCancel flipping false
(9, 11); honest handoff fallback — no destination configured means callbackRequested, never a fabricated number (10);
and a second tenant's verified caller reading the first tenant's appointment as APPOINTMENT_NOT_FOUND (12). The
slot-competition test (13) runs the second caller after the first commits, proving the BUSINESS conflict rule
(`SLOT_UNAVAILABLE` + CHECK_AVAILABILITY); same-instant races are covered by the real-Postgres unique-index proof at
the idempotency layer.

Two fixes this pass: the gateway's conflict mapping now recognizes the engine's actual "Technician is double-booked"
wording (book + reschedule paths), and the E2E surfaced a real product nuance worth knowing: the customer-facing
availability grid does not pad the booking buffer, while `BookingService.create` enforces it — so a boundary slot
can be offered then rejected. The gateway handles this exactly as designed (SLOT_UNAVAILABLE → the agent re-checks
availability), and I have deliberately not "fixed" either engine — they're shared with the POS and customer apps,
and changing buffer semantics is a product decision, not a wiring bug.

Also delivered `docs/ai-receptionist/RETELL_AGENT_PROMPT.md` — the §18 agent behavioral instructions (before-booking/
reschedule/cancel checklists, handoff triggers, error-code handling in caller-safe language, privacy rules). Fresh
numbers: voice modules **125/125 across 13 files**; full api **2727/2727 across 427 files**; tsc 0.

## Addendum 2 — buffer-aware availability (2026-07-04, third pass)

Resolved the buffer nuance the E2E surfaced, without making the product decision I flagged. The code showed the true
shape: `create()` and `BookingService.availability()` both apply `settings.bufferMinutes` (default 5), but the
customer-booking `computeAvailableSlots` the gateway rides on does not — so the raw grid could offer a slot adjacent
to an existing appointment that `create()` then rejects. Rather than change the shared customer-web availability grid
(still a product decision, since it would alter the customer app too), the gateway now re-verifies each candidate
against the EXISTING buffer-aware `BookingService.checkConflict` — the same rule `create()` uses, no duplicated
conflict math — via a new voice-owned `VoiceManageService.filterBookable` (bounded to 16 candidates for phone-paced
latency). Net effect: the AI never offers a time that would fail at booking, cutting the SLOT_UNAVAILABLE re-ask
loop. Voice-path only; customer-web availability is untouched.

Proven by a new E2E assertion: for the seeded Mia 10:00\u201311:00 appointment, the raw grid DOES contain 11:00, and
the gateway's response does NOT (filtered by the 5-minute buffer). Fresh: gateway suites **31/31**, voice modules
**126/126 across 13 files**, full api **2728/2728 across 427 files**, tsc 0, build + lint clean.

The remaining shared-engine question is unchanged and still yours: whether the customer-web availability grid should
also pad the buffer (aligning it with create() for all channels). That's a one-line change to `computeAvailableSlots`
plus its callers, but it changes customer-app behavior, so I've left it for your decision rather than making it here.

## Addendum 3 — gateway observability (2026-07-04, fourth pass)

Closed the §28 observability deliverable — the one remaining Phase 1 item buildable without external accounts or a
product decision. The gateway now has honest, in-process operational metrics surfaced in the EXISTING Super Admin →
AI Receptionist screen (no disconnected dashboard, per §28).

- `voice-gateway-metrics.service.ts` — since-process-start counters: total requests, errors, success rate (NULL until
  there's a denominator — no fabricated 100%), idempotent replays, rate-limit events, handoffs, plus per-operation
  and per-error-code breakdowns. Deliberately low-cardinality (no per-tenant labels, per §28's warning).
- `voice-gateway-metrics.interceptor.ts` — records everything CENTRALLY from the handler name + any thrown
  HttpException, so not one of the nine endpoint bodies changed (lowest-regression instrumentation).
- `super-admin-voice.controller.ts` — `GET /super-admin/voice/gateway-metrics` (SuperAdminGuard) returns the snapshot.
- admin-web `AiReceptionistScreen` — a "Gateway health" section (requests, success %, replays, rate-limit hits,
  handoffs, errors-by-code) with an honest "in-process since <time> — reset on server restart" caption.

Latent bug fixed along the way: the rate limiters were module-level singletons (process-global, un-resettable, and
they leaked state across test files). Moved to controller instance fields — identical production behavior (the
controller is a Nest singleton, so still one process-global limiter pair), but now testable and isolated. This was
caught because the new metrics tests ran the whole voice directory together and surfaced the cross-file contamination.

Fresh, everything green: api **2735/2735 across 428 files** (tsc 0, build clean, lint clean); admin-web **722/722
across 119 files** (tsc 0, build clean). New tests this pass: 8 metrics/interceptor + the admin screen mock.

## Addendum 4 — customer-web buffer alignment + go-live prep (2026-07-04, fifth pass)

Two directives from Kevin: align the customer-web booking buffer, and prep the live Retell/Twilio wiring.

**Buffer alignment (authorized product change).** Inspection settled the ambiguity: the customer-booking subsystem
used buffer 0 CONSISTENTLY — availability, book(), reschedule(), and the race-safe atomic insert — so it was
internally consistent, just not aligned with the POS/voice `create()` default of 5. Made the whole subsystem
buffer-aware: `AvailabilityWindow` now carries `bufferMinutes`; `resolveWindow` sources it from
`BOOKING_BUFFER_MINUTES` (default **5**, matching `DEFAULT_BOOKING_SETTINGS.bufferMinutes`; set 0 to revert);
`computeAvailableSlots` and both write-path conflict checks (service pre-check + kysely atomic insert/reschedule)
apply it. Now every channel — POS, customer-web, and voice — offers and books with the same gap. Proven by a new
pure-function test (a slot touching an appointment's end is free at buffer 0, blocked at buffer 5) and the updated
resolveWindow default/override tests. Because the voice availability grid is now buffer-aware too, the gateway's
`filterBookable` re-check becomes belt-and-suspenders (still valuable: voice availability uses the env buffer while
the voice write uses tenant-settings buffer, so it catches any divergence). Affects `src/customer-booking/*` and,
by sharing `resolveWindow`, the public tech-profile "next slot" (now also buffer-aware — a strict improvement).

**Go-live prep (codeable parts).** Found and fixed a real go-live gap: `handoff` read only `branches.phone` (the
table column), but the number a salon actually edits lives in Business & Branch settings (`tenant_settings`
`business_branch`). `transferDestination` now prefers the settings phone and falls back to the column — both
server-derived, never from Retell. Proven on real Postgres against the actual schema (FK-enforced): settings phone
preferred, branches-column fallback, and branch store-hours override all read correctly. Wrote
`docs/ai-receptionist/GO_LIVE_RUNBOOK.md` — the exact account-setup + configuration sequence (transfer number → issue
`vk_live_` key → env flags → wire the nine Retell functions → point Twilio at Retell → verify via Gateway health →
rollback). No code remains for a basic pilot; the rest is your Retell/Twilio accounts.

Fresh, all green: api **2736/2736 across 428 files**, tsc 0, build clean, lint clean.
