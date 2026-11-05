# AI Reception Copilot — implementation status (honest)

The full spec (59 sections) is a multi-week program. This documents what EXISTS, what was BUILT here, and what
REMAINS — grounded in the codebase, not claims. Nothing below is faked; unbuilt items are listed as remaining.

## Architecture map (spec §1–2 deliverable)
- **Tenant/branch identity**: server-derived `req.ctx` via `tenant-context.middleware` + `TenantAuthGuard`. Never from
  client body/query/header. (Verified across the receptionist + copilot work.)
- **Existing AI assistant** (reuse, not rebuild): `AiAssistantService.run()` + `AiGatewayService` + real providers
  (`OpenAiProvider`, `MockAiProvider` fallback) — tenant-isolated, package-gated, usage-logged. Package
  `ai_reception_copilot` + prompt already exist.
- **Existing AI Phone Receptionist** (built earlier): tenant workspace, booking gateway, Retell/Twilio adapters,
  provisioning, follow-ups, isolation, audit, fleet + provisioning observability.
- **Domain services to reuse**: `CustomersService` (search/detail/appointments, permission-gated `pos.customers.view`,
  tenant-scoped) — includes duplicate detection (§16); `OverviewBoardService.getBoard` (live queue);
  `booking.service` + `customer-booking/availability` (availability); booking mutations via existing booking services.
- **Copilot surface** (built earlier): `POST /tenant/ai/center/copilot` chat over the assistant, pos-web chat screen.

## Built in this pass — the read-only CONTEXT backbone (spec §4, §8–10)
- **`ReceptionCopilotContextService`** (`src/ai-center/`): read-only, NEVER touches the DB, NEVER mutates. Delegates to
  `CustomersService` with the server-derived tenant context. Resolves a caller (by phone) or open customer (by id)
  into a safe projection with an explicit **match state** (`none` = unknown caller / `exact` / `multiple`), masked
  phone, returning-vs-new, last visit, loyalty tier, usual tech/service, and the next upcoming appointment. Caller ID
  is treated as a hint (receptionist confirms). Permission errors from the domain service become an honest `denied`
  state, not a crash. No field is fabricated — absent data is omitted.
- **Endpoint** `POST /tenant/ai/center/copilot/context` on the existing `AiCenterController` (TenantAuthGuard,
  server-derived scope).
- **pos-web**: a "Caller lookup" section on the Reception Copilot screen showing the safe customer card with honest
  unknown/multiple/denied states.
- **Tests**: 6 service tests (match states, masking, server-context delegation/isolation, permission→denied) + 2
  screen tests (lookup shows card; unknown-caller state).

## Action matrix (spec §58 — grounded in real services; ✓ = wired, ○ = remaining)
| Capability | Type | Confirm | Permission | Backend service | Status |
|---|---|---|---|---|---|
| Show customer summary | read-only | no | pos.customers.view | CustomersService | ✓ |
| Chat copilot answer | read-only | no | ai_reception_copilot pkg | AiAssistantService | ✓ |
| Queue summary | read-only | no | pos.* | OverviewBoardService | ○ (service exists; surface next) |
| Recommend availability | read-only | no | pos.booking.* | booking/availability | ○ |
| Recommend technician | read-only | no | pos.* | tech/booking | ○ |
| Detect duplicate | read-only | no | pos.customers.view | CustomersService dedup (§16 exists) | ○ (surface) |
| Create/reschedule/cancel appt | mutation | yes | pos.booking.* | booking.service | ○ (confirmation-card flow) |
| Create/merge customer | mutation | yes | pos.customers.* | CustomersService | ○ |
| Add to waitlist | mutation | yes | pos.* | existing waitlist | ○ |
| Send message | mutation | yes | pos.* | comms service | ○ |
| Take over call | mutation | yes | reception_copilot.take_over | Retell/Twilio runtime | ○ (provider-account gated) |

## Remaining (honest, large): intent detection UI, interaction summaries via assistant, availability/technician
## recommendation surfaces, conflict detection, rebooking/waitlist, queue summary surface, draft-message + follow-up
## flows, duplicate-candidate UI, AI-phone-action timeline, live-call takeover (provider-gated), structured
## mutation-confirmation cards routing to domain services, the 8 reception_copilot_* tables + settings hierarchy,
## Redis/worker/noisy-neighbor isolation, full Super Admin wiring, and the unit/integration/security/load matrices.
## Each is a real slice on top of this backbone; none is faked here.

## Verified this pass
api **2811/2811 across 443 files**, pos-web **318/318 across 70 files** (both tsc 0, builds clean, lint clean).
Isolation: the context service delegates with server-derived tenant context (test-proven); it inherits
CustomersService's tenant scoping + `pos.customers.view` gate. No new tables; no direct DB access from copilot code.

## Slice 2 — Live queue summary (spec §19)
- **`ReceptionCopilotContextService.queueSummary(ctx)`**: read-only, delegates to the tenant+branch-scoped
  `QueueService.items` (permission-gated `pos.queue.view`). Summarizes waiting / in-service / unassigned / VIP-waiting
  counts + longest wait (labeled an estimate) from real queue rows. Requires a branch in context — with none, returns
  `available:false` rather than fabricating zeros. Permission error → honest `denied`.
- **Endpoint** `GET /tenant/ai/center/copilot/queue`. **pos-web**: a "Queue now" strip on the copilot screen.
- **Tests**: 3 (no-branch honesty, real-item summarization incl. status/vip/unassigned/longest-wait math, permission→denied).
- Action matrix row "Queue summary" → now ✓.

Verified: api **2814/2814 across 443 files**, pos-web **318/318 across 70 files** (both tsc 0, builds clean, lint clean).

## Slice 3 — Mutation-confirmation spine (spec §25–29)
The architectural backbone: advisory by default; a human must confirm; every mutation routes through an existing
authorized domain service (never a direct DB write); scope is server-derived; every mutation is audited.

- **`ReceptionCopilotActionService.execute(ctx, action)`**: without `confirm===true` it returns
  `HUMAN_CONFIRMATION_REQUIRED` and performs NO write. With confirmation it delegates the mutation to the domain
  service (which re-checks permission + ownership + rules inside its own transaction) and records a `RECEPTION_COPILOT`
  audit event via the shared `AuditService`. First wired action: **cancel_appointment** → `BookingService.cancel`
  (enforces `pos.booking.cancel`, verifies ownership). Stable error taxonomy (§49): HUMAN_CONFIRMATION_REQUIRED,
  INSUFFICIENT_PERMISSION, APPOINTMENT_NOT_FOUND, INTERNAL_ERROR.
- **Endpoint** `POST /tenant/ai/center/copilot/action` (server-derived scope).
- **pos-web**: a "Cancel an appointment" action with a two-step **structured confirmation card** — Prepare shows the
  card (no write), Confirm executes; honest success / permission-denied / error states.
- **Tests** (5 service + 1 screen): no write without confirmation; on confirm routes to BookingService with server
  scope + audits; permission error → INSUFFICIENT_PERMISSION with NO audit of a non-action; reason/branch required;
  a spoofed body tenantId cannot change the tenant the action runs against.

Action matrix: "Cancel appointment" mutation row → now ✓ (the spine; create/reschedule/waitlist/send-message follow
the same pattern next).

Verified: api **2819/2819 across 444 files**, pos-web **319/319 across 70 files** (both tsc 0, builds clean, lint clean).

## Slice 4 — Duplicate-candidate detection (spec §16/§22)
- **`ReceptionCopilotContextService.duplicateCandidates(ctx)`**: read-only, delegates to the existing tenant-scoped
  `CustomersService.duplicates` (permission-gated `pos.customers.view`, already audited). Projects duplicate groups to
  safe candidates (masked phone, display name, visit count) with the match reason. Review-only — it NEVER merges (a
  merge would be a separate confirmed action through the customer-merge service, following the Slice-3 spine).
- **Endpoint** `GET /tenant/ai/center/copilot/duplicates`. **pos-web**: a "Possible duplicate customers" section that
  lists candidate groups with an explicit "review only — never merged automatically" note.
- **Tests**: 2 (projects real groups with masked phones; permission → denied).
- Action matrix "Detect duplicate" → now ✓.

Verified: api **2821/2821 across 444 files**, pos-web **319/319 across 70 files** (both tsc 0, builds clean, lint clean).

## Copilot slices complete so far
Customer context (§8–10) ✓ · Queue summary (§19) ✓ · Mutation-confirmation spine + cancel_appointment (§25–29) ✓ ·
Duplicate detection (§16/§22) ✓. Read-only backbone + the safe action pattern are both real and tested. Remaining is
as listed above (intent detection, recommendations, rebooking, draft messages, live-call takeover [provider-gated],
the reception_copilot_* tables + settings hierarchy, Redis/worker isolation, full Super Admin wiring, load/a11y matrices).

## Slice 5 — Availability recommendations (spec §14)
- **`ReceptionCopilotContextService.recommendAvailability(ctx, {date?, serviceIds?, technicianId?})`**: read-only,
  delegates to the real schedule-aware `BookingService.availability` (store hours ∩ tech schedule − breaks − blocked −
  buffers − existing appointments), permission-gated `pos.booking.view`. Flattens per-tech open slots into the earliest
  ~6 recommendations + a per-technician breakdown. NO Copilot-only availability engine. Requires a branch; empty
  availability returns `available:false` (no fabricated slots); permission error → denied.
- **Endpoint** `POST /tenant/ai/center/copilot/availability`. **pos-web**: a "Find open times" section (date picker →
  earliest-opening chips with technician), honest no-availability / denied states.
- **Tests**: 4 (earliest-first flattening + per-tech breakdown from real engine; no-branch honesty; empty→false;
  permission→denied).
- Action matrix "Recommend availability" → now ✓.

Verified: api **2825/2825 across 444 files**, pos-web **319/319 across 70 files** (both tsc 0, builds clean, lint clean).

## Copilot slices complete: 5
Customer context (§8–10) ✓ · Queue summary (§19) ✓ · Availability recommendations (§14) ✓ · Duplicate detection
(§16/§22) ✓ · Mutation-confirmation spine + cancel_appointment (§25–29) ✓.

## Slice 6 — Appointment conflict detection (spec §16)
- **`ReceptionCopilotContextService.detectConflict(ctx, {technicianId, startTime, endTime, date?})`**: read-only,
  delegates to the buffer-aware `BookingService.checkConflict` (permission-gated `pos.booking.view`). Advisory — the
  backend still re-validates during any actual booking transaction. Requires a branch + the core inputs; missing
  inputs return `unavailable` (never a false "clear"); permission error → denied.
- **Endpoint** `POST /tenant/ai/center/copilot/conflict`. **pos-web**: a "Check for conflicts" section with a clear
  conflict / clear / unavailable / denied message.
- **Tests**: 4 (conflict reported with conflicting appointment id; clear slot; missing-input/no-branch → unavailable;
  permission→denied).
- Action matrix "Detect conflict" → now ✓.

Verified: api **2829/2829 across 444 files**, pos-web **319/319 across 70 files** (both tsc 0, builds clean, lint clean).

## Copilot slices complete: 6
Customer context (§8–10) ✓ · Queue summary (§19) ✓ · Availability recommendations (§14) ✓ · Conflict detection (§16)
✓ · Duplicate detection (§16/§22) ✓ · Mutation-confirmation spine + cancel_appointment (§25–29) ✓.

## Slice 7 — Technician recommendations (spec §15)
- **`ReceptionCopilotContextService.recommendTechnicians(ctx, {serviceIds?, date?, preferredTechnicianName?})`**:
  read-only. Reuses the real schedule-aware `BookingService.availability` (qualification + schedule already applied),
  ranks qualified technicians by earliest availability then open-slot count (a light workload signal), drops techs
  with no openings, and floats the customer's usual technician (`isUsual`) to the top. No payroll/commission/private
  fields exposed. Requires a branch; permission (`pos.booking.view`) enforced by the domain service; permission error
  → denied.
- **Endpoint** `POST /tenant/ai/center/copilot/technicians`. **pos-web**: "Recommended technicians" shown alongside the
  "Find open times" results (same date).
- **Tests**: 4 (earliest-first ranking + drop-empty; usual-tech floats to top; no-branch → false; permission→denied).
- Action matrix "Recommend technician" → now ✓.

Verified: api **2833/2833 across 444 files**, pos-web **319/319 across 70 files** (both tsc 0, builds clean, lint clean).

## Copilot slices complete: 7
Customer context (§8–10) ✓ · Queue summary (§19) ✓ · Availability (§14) ✓ · Technician recommendations (§15) ✓ ·
Conflict detection (§16) ✓ · Duplicate detection (§16/§22) ✓ · Mutation-confirmation spine + cancel_appointment
(§25–29) ✓. All delegate to existing domain services; none duplicates booking/customer/queue logic.

## Slice 8 — Spine generalizes: reschedule_appointment (spec §27)
Proves the mutation spine isn't a one-off — a second action follows the identical safe pattern.
- **`ReceptionCopilotActionService`** gained `reschedule_appointment`: no write without `confirm===true`; on
  confirmation delegates to `BookingService.reschedule` (enforces `pos.booking.reschedule`, re-checks store hours,
  technician windows, and conflicts inside its transaction) and records an `appointment.rescheduled` audit event.
  Errors map to the taxonomy: APPOINTMENT_CONFLICT, APPOINTMENT_NOT_MODIFIABLE, INSUFFICIENT_PERMISSION,
  APPOINTMENT_NOT_FOUND.
- **pos-web**: a "Reschedule an appointment" section with its own two-step structured confirmation card (Review →
  Confirm reschedule), honest conflict / permission / error states.
- **Tests** (4 service + 1 screen): no write without confirmation; confirm routes to reschedule + audits; conflict →
  APPOINTMENT_CONFLICT; start-time required; UI confirm-gate.
- Action matrix "Reschedule appointment" → now ✓.

Verified: api **2837/2837 across 444 files**, pos-web **320/320 across 70 files** (both tsc 0, builds clean, lint clean).

## Copilot slices complete: 8
Customer context (§8–10) ✓ · Queue summary (§19) ✓ · Availability (§14) ✓ · Technician recs (§15) ✓ · Conflict
detection (§16) ✓ · Duplicate detection (§16/§22) ✓ · Mutation spine: cancel_appointment + reschedule_appointment
(§25–29) ✓. Action matrix rows done: show summary, availability, technician, duplicate, conflict, cancel, reschedule.

## Slice 9 — Spine: create_appointment (spec §29) + honest waitlist note
- **Waitlist (§18) — honest finding**: there is NO reusable waitlist service/system in the codebase (only scattered
  references). Rather than build a second waitlist subsystem (which §18 explicitly forbids) or fake one, add-to-waitlist
  is deferred and recorded here as blocked-on-a-real-waitlist-service. Not faked.
- **`create_appointment`** added to the spine: no write without `confirm===true`; on confirmation delegates to
  `BookingService.create` (enforces `pos.booking.create`, re-checks availability + conflicts under an advisory lock
  against concurrent double-booking) and records an `appointment.created` audit event. Errors map to
  APPOINTMENT_CONFLICT / SLOT_UNAVAILABLE / SERVICE_NOT_FOUND / INSUFFICIENT_PERMISSION.
- **pos-web**: a "Book an appointment" section with its own Review → Confirm booking card; honest conflict/permission
  states.
- **Tests** (4 service + reuses screen harness): no write without confirmation; confirm routes to create + audits;
  taken slot → APPOINTMENT_CONFLICT; required-field validation.
- Action matrix "Create appointment" → now ✓.

Verified: api **2841/2841 across 444 files**, pos-web **320/320 across 70 files** (both tsc 0, builds clean, lint clean).

## Copilot slices complete: 9 (spine now: create + reschedule + cancel)
Read: customer context (§8–10), queue (§19), availability (§14), technician recs (§15), conflict (§16), duplicates
(§16/§22). Write (confirm→domain service→audit): create / reschedule / cancel appointment (§25–29). Every action
routes through an existing domain service; none duplicates booking/customer/queue logic; nothing mutates without
explicit human confirmation.

## Slice 10 — Idempotency for the mutation spine (spec §28/§49)
Closes a gap flagged in Slice 3: the spine accepted an idempotencyKey but didn't dedupe on it.
- **Migration 307** `reception_copilot_action_ledger` — unique `(tenant_id, idempotency_key)`; stores only the compact
  outcome (ok + resource id), never sensitive input. Proven on real Postgres (a duplicate insert raises
  unique_violation → IDEM_OK). Migrations 301–307 apply cleanly in sequence.
- **`ReceptionCopilotActionService`**: before executing a confirmed action with an idempotency key, it checks the
  ledger and **replays the recorded outcome** (result.duplicate=true) instead of executing again; after executing it
  records the outcome (ON CONFLICT DO NOTHING for the concurrent race). Injected via `@Optional()` so existing tests
  and callers are unaffected. Kysely repo when a DB is present, in-memory otherwise.
- **pos-web**: the "Book an appointment" confirm now sends a deterministic idempotency key, so a double-click or retry
  can't double-book.
- **Tests**: 2 (repeated key executes once + replays; distinct keys each execute) + real-PG unique-constraint proof.

Verified: api **2843/2843 across 444 files**, pos-web **320/320 across 70 files** (both tsc 0, builds clean, lint clean).

## Copilot slices complete: 10
6 read surfaces + 3 write actions (create/reschedule/cancel) + idempotency. The mutation spine now: advisory →
human-confirm → authorized domain service (revalidates) → **idempotent** → audit. Remaining (honest): LLM-dependent
(intent, draft messages), provider-gated (live-call takeover, AI-phone timeline), a real waitlist service (absent),
and the infra tier (remaining reception_copilot_* tables + settings hierarchy, Redis/worker isolation, Super Admin
usage wiring, load/a11y matrices).

## Slice 11 — Send message via Twilio (spec §20 / send-message action)
Kevin is on Twilio, so this wires the copilot's messaging through the EXISTING Twilio-backed send path — not a
copilot-only sender.
- **`send_message`** added to the spine: no send without `confirm===true`; on confirmation delegates to
  `NotificationsService.send({channel:'sms', to, body, customerId})`, which meters SMS credits (can't send without
  them), enforces opt-out, sends via the configured `TwilioSmsSender` (`api.twilio.com/.../Messages.json`), and logs
  the attempt. Records a `message.sent` audit event. Idempotent via the Slice-10 ledger.
- **Honest degraded state**: when no Twilio creds are configured the sender returns a mock sid (`SM-MOCK-…`); the
  result carries `degraded:true` and the UI says plainly that no real text went out until Twilio credentials are set.
- **Error taxonomy**: MESSAGE_OPTED_OUT, NO_MESSAGE_CREDITS, MESSAGE_SEND_FAILED, INSUFFICIENT_PERMISSION.
- **pos-web**: a "Send a text message" section with a Review → Confirm send card.
- **Tests** (5): no send without confirmation; confirm routes through NotificationsService (Twilio path) + audits;
  mock sender → degraded; opt-out/over-limit → honest codes; recipient/body required.

### To send real texts (owner step)
Set Twilio credentials in the API env so the SMS sender resolves to `TwilioSmsSender` instead of the mock:
`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` (the SMS-capable Twilio number). No code change needed — the
notification layer picks Twilio automatically when these are present; until then it honestly logs as mock.

Verified: api **2848/2848 across 444 files**, pos-web **320/320 across 70 files** (both tsc 0, builds clean, lint clean).

## Copilot slices complete: 11
6 read surfaces + 4 write actions (create / reschedule / cancel appointment, send SMS) + idempotency, all routing
through existing domain services, all confirm-gated + audited.

## Slice 12 — Message drafting (spec §20, deterministic path)
Pairs with send-message: the Copilot drafts a text the receptionist reviews and sends via the existing action.
- **`ReceptionCopilotContextService.draftMessage(ctx, {kind, customerId?, phone?})`**: read-only, deterministic
  templates (reminder / running_late / ready_now / thank_you / reschedule_offer) enriched with the customer's REAL
  upcoming appointment (reused from `customerContext`). Never invents details — appointment clauses appear only when
  real data exists; unknown caller → generic greeting; times taken from the ISO string's own components (no timezone
  drift). No LLM required (works today); an AI provider can refine later.
- **Endpoint** `POST /tenant/ai/center/copilot/draft-message`. **pos-web**: template chips in the "Send a text
  message" section that fill the body from real data; the receptionist edits, then sends through the confirm-gated
  send_message action.
- **Tests**: 3 (fills real appointment details when matched; unknown caller → generic, no fabricated date;
  running_late needs no appointment).
- Action matrix "Draft message" → now ✓ (deterministic path).

Verified: api **2851/2851 across 444 files**, pos-web **320/320 across 70 files** (both tsc 0, builds clean, lint clean).

## Copilot slices complete: 12
Read: customer context, queue, availability, technician recs, conflict, duplicates, draft message. Write (confirm →
domain service → idempotent → audit): create / reschedule / cancel appointment, send SMS (Twilio). Every capability
routes through existing domain services; nothing mutates without explicit confirmation.

## Slice 13 — Super Admin copilot-usage rollup (spec §46/§51, backend)
Cross-tenant oversight of Reception Copilot activity, sourced from the canonical audit trail.
- **`CopilotUsageService.summary({from?, to?})`**: runs a read-only GROUP BY over `audit_events` where
  `module='reception_copilot'` (the events every confirmed action already emits), returning total + counts by action
  and by tenant within an optional ISO window. No separate metrics store to drift; honest `available:false` when no DB.
  Pure `aggregateCopilotUsage()` core is unit-tested; the SQL is proven on real Postgres (counts 5 copilot events
  across 2 tenants, correctly excludes an unrelated `checkout` event → USAGE_OK).
- **`SuperAdminCopilotController`** `GET /super-admin/copilot/usage` — `@UseGuards(SuperAdminGuard)`, cross-tenant
  aggregates only (no per-customer or message-body data). Mirrors the existing super-admin-voice fleet pattern.
- **Tests**: 3 (grouping + totals + ordering; empty input; no-DB → available:false) + real-PG GROUP BY proof.
- **Honest remaining half**: the admin-web card that renders this endpoint is a follow-up (separate app); the API
  surface + aggregate are done and tested.

Verified: api **2854/2854 across 445 files** (tsc 0, build clean, lint clean); pos-web unchanged **320/320**.

## Copilot slices complete: 13
7 read surfaces + 4 write actions + idempotency + Super Admin usage API. Everything routes through existing domain
services / the canonical audit trail; nothing mutates without confirmation; provider- and LLM-gated features render
honest states, never fabricated.

## Slice 13b — Reception Copilot usage card (admin-web, completes §46 end-to-end)
The admin-web surface for the Slice-13 endpoint — Slice 13 is now a full feature, not just an API.
- **`ReceptionCopilotUsageScreen`** (Super Admin → AI → "Reception Copilot"): read-only, renders
  `GET /super-admin/copilot/usage` — total confirmed actions + breakdown by action and by tenant. No per-customer or
  message-body data. Honest states: loading, load-error, and an explicit "not available in this environment" instead
  of fabricated numbers.
- Wired: `superAdminAiApi.copilotUsage()`, route `/reception-copilot`, nav item under AI (after AI Receptionist).
- **Tests**: 2 (renders total + per-action/per-tenant breakdown; honest not-available state).

Verified: admin-web **724/724 across 120 files** (tsc 0, build clean, lint clean). api unchanged **2854/2854**; pos-web
unchanged **320/320**.

## Copilot slices complete: 13 (+ admin-web card)
7 read surfaces + 4 write actions + idempotency + Super Admin usage (API **and** admin-web card). The Reception Copilot
is a coherent, tested feature end-to-end: staff-facing assistant in pos-web, safe confirm-gated + idempotent + audited
actions through existing domain services, Twilio-backed messaging (honest mock until creds set), and cross-tenant
oversight in admin-web. Remaining is the gated/heavy tier (LLM intent detection, live-call takeover [provider-gated],
a real waitlist service, settings hierarchy + remaining reception_copilot_* tables, Redis/worker isolation,
load/a11y matrices).

## Slice 14 — Copilot settings that gate the spine (spec §47)
Per-tenant toggles that actually change behaviour — not decorative config.
- **Reuse, no new table**: `CopilotSettingsService` stores settings in the EXISTING generic `tenant_settings` JSONB
  store under category `reception_copilot` (PosSettingsService safely ignores this category). Settings:
  `enabled`, `actionsEnabled`, `allowCreate`, `allowReschedule`, `allowCancel`, `allowSendMessage` (default all true).
  Scope server-derived; `get` overlays stored booleans onto defaults (ignores junk); `patch` requires `ai.manage` and
  is audited (`settings.updated`). Tenant-wide today (branch_id NULL); branch overrides a documented future layer.
- **Real enforcement**: the action spine reads settings before executing a confirmed action — master-off or a
  per-action toggle-off returns `ACTION_DISABLED` with NO domain call. So a disabled setting genuinely stops the action.
- **Endpoints** `GET`/`PATCH /tenant/ai/center/copilot/settings`. **pos-web**: a "Copilot settings" toggle panel
  (persists on change; honest no-permission note) and every action button is disabled when its setting is off.
- **Real-Postgres bug caught + fixed**: `ON CONFLICT (tenant_id, branch_id, category)` does NOT dedupe when branch_id
  is NULL (Postgres treats NULLs as distinct in unique constraints) — it created two rows. Switched to the existing
  repo's select-then-update/insert with `branch_id IS NULL`; re-proved single-row correct upsert (SETTINGS_OK).
- **Tests**: 6 service (merge/defaults/permission) + 3 action-gate (master off, per-action off, all-on runs) + 1 screen
  (button disabled when setting off) + real-PG upsert proof.

Verified: api **2862/2862 across 446 files**, pos-web **321/321 across 70 files** (tsc 0, builds clean, lint clean);
admin-web unchanged **724/724**.

## Copilot slices complete: 14
7 read surfaces + 4 write actions + idempotency + Super Admin usage (API+card) + per-tenant settings gate. Everything
reuses existing domain services / tables; nothing mutates without confirmation; settings, Twilio, and LLM states are
all honest.

## Slice 15 — Branch-level settings hierarchy (spec §47)
Extends Slice 14 into a real override hierarchy: a setting resolves branch → tenant → default, and the action spine
enforces the effective value for the acting branch.
- **`get(ctx)` is now branch-aware**: overlays defaults ← tenant-wide (branch NULL) ← branch-specific (this branch).
- **`patch(ctx, patch, level)`** writes at `'tenant'` or `'branch'` level; branch rows stay **sparse** (only keys set
  at branch level are stored) so a later tenant-wide change still propagates to branches that haven't overridden that
  key. Branch level requires a branch; both require `ai.manage`; audited with the level.
- **Endpoint** `PATCH /tenant/ai/center/copilot/settings` accepts `level: 'tenant'|'branch'`. **pos-web**: an
  "All branches / This branch only" scope toggle on the settings panel.
- **Real-Postgres hierarchy proof**: tenant sets allowCancel=false + allowSendMessage=false; branch overrides
  allowCancel=true (sparse); resolved for the branch → allowCancel=true (branch wins) while allowSendMessage=false
  (falls through to tenant); tenant-wide effective allowCancel stays false → HIER_OK.
- **Tests**: layering unit tests (branch overlay wins, un-overridden falls through) + branch-requires-branch +
  honest no-DB patch + real-PG hierarchy proof.

Verified: api **2864/2864 across 446 files**, pos-web **321/321 across 70 files** (tsc 0, builds clean, lint clean);
admin-web unchanged **724/724**.

## Copilot slices complete: 15
7 read surfaces + 4 write actions + idempotency + Super Admin usage (API+card) + settings with branch-level hierarchy.
The reusable, no-account surface of the Reception Copilot is now substantially built. Genuinely remaining is the
gated/heavy tail: LLM intent + free-form drafting (AI key), live-call takeover + AI-phone timeline (provider-gated),
a real waitlist service (absent), Redis/worker noisy-neighbor isolation, load/accessibility matrices.

## Slice 16 — Intent detection (spec §11, deterministic path)
Routes a receptionist's free-text to the right Copilot capability. Same honest pattern as drafting: works today with no
AI key; an LLM can refine later.
- **`classifyIntent(text)`**: pure keyword classifier scoring 8 intents (cancel / reschedule / book / availability /
  send-message / customer-lookup / queue-status / general). Returns the strongest intent, a friendly label, matched
  cues, and a confidence (high when ≥2 cues). Advisory only — it suggests where to go, never acts. Empty/unmatched →
  general_question, low confidence.
- **Endpoint** `POST /tenant/ai/center/copilot/intent`. **pos-web**: as the receptionist types in the chat box, a
  debounced hint ("Looks like: Cancel an appointment") points them to the matching section.
- **Tests**: 7 parametrised classifications + empty/unmatched + multi-cue-raises-confidence.

Verified: api **2873/2873 across 446 files**, pos-web **321/321 across 70 files** (tsc 0, builds clean, lint clean);
admin-web unchanged **724/724**.

## Copilot slices complete: 16
7 read surfaces (incl. draft + intent) + 4 write actions + idempotency + Super Admin usage (API+card) + branch-level
settings hierarchy. This completes the deterministic, no-account surface of the Reception Copilot. The genuinely
remaining items are all gated or absent-dependency: LLM *refinement* of intent/drafting (needs an AI provider key),
live-call takeover + AI-phone timeline (provider-gated), a real waitlist service (does not exist to reuse),
Redis/worker noisy-neighbor isolation, and load/accessibility matrices.

## Slice 17 — Scale hardening for 10k+ tenants (measured, not claimed)
Concrete, index-grounded fixes to the three real hot paths — plus honest scope on what's ops-level.
- **Cross-tenant usage index (migration 308)**: `audit_events` had only tenant_id-leading indexes, so the Super Admin
  usage query (`WHERE module='reception_copilot' … GROUP BY action, tenant_id`, no tenant filter) would table-scan at
  scale. Added `idx_audit_events_module_occurred (module, occurred_at DESC)`. Proven: EXPLAIN shows
  `Index Scan using idx_audit_events_module_occurred`. Migrations 301–308 apply cleanly in sequence.
- **Bounded usage window**: `CopilotUsageService.summary()` now defaults to the last 30 days (explicit from/to still
  honoured) so the aggregate is always time-bounded and index-supported — never an all-time scan across 10k tenants.
- **Settings cache (per-action hot path)**: the action spine calls `settings.get()` on every confirmed action.
  Added a short-TTL (30s), size-capped (50k) in-memory cache keyed by (tenant, branch); `patch()` invalidates the
  tenant's entries immediately (same-instance exact; cross-instance staleness bounded by TTL). Turns one DB read per
  action into one per (tenant,branch) per 30s. Tested: second get cached, invalidation rebuilds.

### Honest scope on "10k+ tenants"
Done in code (real): tenant/branch scoping is server-derived everywhere; hot queries are indexed + bounded; the
idempotency ledger and settings rows are covered by unique indexes; the settings hot path is cached. NOT done here,
because they are deployment/ops decisions that can't be meaningfully built or validated from inside the repo:
DB connection pooling + read replicas, horizontal API scaling, a shared cache (Redis) for cross-instance settings
invalidation, and per-tenant rate limiting / noisy-neighbor quotas. These are flagged for the infra layer, not faked.

Verified: api **2874/2874 across 446 files** (tsc 0, build clean, lint clean); pos-web unchanged **321/321**;
admin-web unchanged **724/724**.

## Copilot slices complete: 17
The Reception Copilot is feature-complete on its deterministic, no-account surface and hardened on its measured hot
paths for many-tenant scale. LLM refinement of intent/drafting is ready to switch on the moment an AI provider key is
set (deterministic today, honest mock via AiAssistantService). Remaining is genuinely gated (provider go-live for
live-call takeover) or ops-level (Redis/pooling/replicas/per-tenant quotas).

## Slice 18 — Inbound Twilio SMS + opt-out compliance (multi-tenant)
Closes a real production gap in the messaging path: when a customer texts STOP/START, nothing was recording it. Left
unhandled that's a TCPA/A2P violation that can get a Twilio number blocked — critical across 10k tenants.
- **Number registry (migration 309)** `tenant_messaging_numbers` (phone_number UNIQUE → tenant): the inbound webhook
  only knows the `To` number, so it must resolve To → tenant. `registerNumber(tenant, number)` upserts (moving a number
  between tenants is a single row — proven NUM_OK on real Postgres).
- **Signature-verified inbound webhook** `POST /webhooks/twilio/sms/inbound` (no auth guard — Twilio is the caller;
  every request is verified). Pure `computeTwilioSignature`/`verifyTwilioSignature` (HMAC-SHA1 over URL+sorted params,
  base64, timing-safe compare) + `classifyInboundKeyword` (STOP/UNSUBSCRIBE/CANCEL/QUIT/END → stop; START/YES/UNSTOP →
  start; HELP → help). `TwilioInboundService.handleInbound` verifies the signature, resolves the tenant, and records
  STOP/START through the EXISTING `NotificationsService.recordOptOut/recordOptIn` (system-initiated) — so the app's
  opt-out state stays in sync with what customers text. Security-first: with no `TWILIO_AUTH_TOKEN` it refuses rather
  than trust an unverified POST.
- **Tests**: 7 (signature verify + tamper/again/no-token; keyword parsing; opt-out on verified STOP; opt-in on START;
  bad-signature ignored + no write; unknown number ignored; no-token refused) + real-PG registry upsert proof.

### Owner/ops steps for real inbound
Set `TWILIO_AUTH_TOKEN`; point each tenant's Twilio number's inbound webhook to `/webhooks/twilio/sms/inbound`; and
register each number via `registerNumber(tenantId, number)` when it's assigned. HONEST LIMITATION: the send path today
uses a single shared `TWILIO_FROM` env; true per-tenant A2P at 10k tenants needs a per-tenant `from` number (each
tenant their own registered number) — the registry is the foundation for that, but per-tenant number provisioning +
per-tenant `from` on the send side is the remaining integration (owner/provisioning concern, not faked here).

Verified: api **2881/2881 across 447 files** (tsc 0, build clean, lint clean); migrations 301–309 apply in sequence;
pos-web **321/321** and admin-web **724/724** unchanged.

## Slice 19 — Twilio delivery status receipts
Companion to inbound: the send path now knows whether a text actually landed, not just that it left.
- **Migration 310**: extend `notifications.status` CHECK to allow `delivered` + add `delivered_at` + index on
  `provider_id` (the Twilio MessageSid) for the status lookup.
- **`NotificationsService.recordDeliveryStatus(providerId, providerStatus)`**: maps Twilio MessageStatus →
  delivered / failed / sent (queued/sending ignored), keyed by the globally-unique sid (no tenant lookup needed);
  records `delivered_at` on delivery and `failure_reason` on failure. New repo method `updateDeliveryByProvider`
  (port + InMemory + Kysely).
- **Sender**: `TwilioSmsSender` now sets `StatusCallback` when `TWILIO_STATUS_CALLBACK_URL` is configured (honest —
  no callback requested unless the owner sets it).
- **Signature-verified status webhook** `POST /webhooks/twilio/sms/status` → `TwilioInboundService.handleStatus`
  (verifies signature, then records). Security-first: refuses without `TWILIO_AUTH_TOKEN`.
- **Tests**: 2 (records on verified callback; forged callback ignored, no write) + real-PG delivered proof (DELIV_OK).

### Owner step
Set `TWILIO_STATUS_CALLBACK_URL` to `<public>/webhooks/twilio/sms/status`. Twilio then posts delivery receipts and the
notification log flips sent → delivered / failed automatically.

Verified: api **2883/2883 across 447 files** (tsc 0, build clean, lint clean); migrations 301–310 apply in sequence;
pos-web **321/321** and admin-web **724/724** unchanged.

## Twilio messaging loop — now complete both directions
Outbound (send + draft, Slice 11/12) → inbound opt-out (STOP/START, Slice 18) → delivery receipts (Slice 19), all
signature-verified and reusing the existing notifications layer. Remaining Twilio work is owner/ops: per-tenant numbers
+ per-tenant `from` for true multi-tenant A2P (registry foundation built in Slice 18), and setting the env vars.

## Deliverable — Twilio & 10k-tenant deployment runbook
`AIPowerSalon-Twilio-Scale-Runbook.md` (also in apps/api/docs/): the owner/ops guide that pairs with the built code.
Covers exact env vars + webhook URLs (send/inbound/status), the ISV A2P 10DLC model (Primary profile → per-tenant
Secondary/Brand/Campaign → Messaging Service → numbers; ~10–15 day campaign reviews; verified against current Twilio
docs), Twilio Advanced Opt-Out vs the app-side opt-out sync, the shared-`TWILIO_FROM` limitation + the per-tenant-number
path (registry already built; per-tenant `from` is the next slice once numbers are provisioned), delivery-receipt
config, the separate voice go-live, the AI-key upgrade path, and the full 10k-tenant scale checklist (done-in-code vs
owner/ops: Redis, pooling, read replicas, per-tenant quotas, audit partitioning). Honest boundaries section included.

## Slice 20 — Per-tenant sender number (completes multi-tenant SMS in code)
Closes the code half of the §4 shared-number limitation. Works today with the shared number; automatically uses a
tenant's own number the moment one is registered — no further code change.
- **`SmsSender.send(to, body, from?)`**: optional per-message `from`. `TwilioSmsSender` uses `from || cfg.from`;
  `MockSmsSender` records it. Backward-compatible (existing OTP/reset callers unchanged).
- **`SenderNumberResolver`** (Kysely + Null): resolves a tenant's registered SMS number from `tenant_messaging_numbers`
  (migration 309); returns null when none → caller falls back to the shared `TWILIO_FROM`.
- **`NotificationsService.send`**: for SMS, resolves the per-tenant `from` and passes it to the sender (fail-soft:
  resolver error → default number).
- **Tests**: 2 (registered number used as from; no number → default) + real-PG resolveFrom proof (FROM_OK).

With this, the only remaining per-tenant-number work is owner/ops: buy a number per salon and call
`registerNumber(tenantId, number)` at provisioning (Slice 18). Sending, inbound routing, and delivery receipts then all
key off that number automatically.

Verified: api **2885/2885 across 448 files** (tsc 0, build clean, lint clean); pos-web **321/321** and admin-web
**724/724** unchanged.

## Slice 21 — Per-tenant Twilio credentials in Super Admin
Lets you configure EACH salon's own Twilio account from Super Admin, so every tenant sends on its own account/number —
the real multi-tenant A2P setup, no shared env var required.
- **Migration 311** `tenant_messaging_credentials` (unique per tenant+provider): account_sid, auth_token_enc
  (AES-256-GCM via the existing `provider-crypto` / `PROVIDER_VAULT_KEK`), auth_token_last4 (masked hint), from_number,
  status. The auth token is **write-only** — never returned by any read path.
- **`TenantMessagingCredentialsService`**: `getMasked` (account SID, from, status, last4 only) + `set` (validates
  E.164 from, encrypts token, token optional on update = rotation, audits `tenant_credentials.updated`, and syncs the
  from number into `tenant_messaging_numbers` so inbound routing + per-tenant send agree).
- **Super-Admin endpoints** `GET/PUT /super-admin/tenants/:tenantId/messaging-credentials` (`SuperAdminGuard`).
- **Send path**: `KyselyTenantSmsSenderResolver` builds a per-tenant `TwilioSmsSender` from the decrypted creds;
  `NotificationsService.send` prefers the tenant's own account (its own from), else falls back to the shared sender +
  registered number (Slice 20), else the shared default. Fail-soft (undecryptable/incomplete → fall back, never crash a
  send).
- **admin-web**: `TenantMessagingSetupScreen` (route `/tenants/:tenantId/messaging`) — Account SID, Auth Token
  (write-only, masked `••••last4` after save), From number; honest "not configured → uses shared" state.
- **Tests**: 6 api (validation, masking never leaks the token, resolver fallback) + 2 admin-web (masked hint shown,
  save clears token) + real-PG round-trip (encrypt → masked read no-leak → decrypt matches: CRED_OK).

### Owner step
For each salon: open Super Admin → that tenant → Twilio setup, enter the salon's Account SID, Auth Token, and From
number. From then on that salon's texts send from its own account; leaving it blank keeps the salon on the shared
default. (Set `PROVIDER_VAULT_KEK` in the API env so tokens encrypt with a real key.)

Verified: api **2891/2891 across 449 files**, admin-web **726/726 across 121 files** (tsc 0, builds clean, lint clean);
migrations 301–311 apply in sequence; pos-web unchanged **321/321**.

## Slice 22 — Wire per-tenant Twilio setup into both sidebars (frontend + backend)
Made the credential feature reachable from navigation on both sides, and added a tenant self-service path so a salon
can configure its own Twilio without Super Admin.
- **Backend (self-service)**: `TenantMessagingSelfController` — `GET/PUT /tenant/messaging/credentials`, behind
  `TenantAuthGuard`, tenant taken from `req.ctx` (never the client, so a salon can only touch its own creds). Writes
  require `settings.edit`. Reuses `TenantMessagingCredentialsService` (token still write-only). Tests: 3 (scoped read,
  reject without settings.edit, allowed write scoped to session tenant + no token echoed).
- **admin-web (Super Admin sidebar)**: new nav item **AI & Automation → Tenant Messaging (Twilio)** → `/tenant-messaging`.
  The screen now works with no URL tenantId by showing a **tenant selector** (populated from `superAdminApi.state()`);
  the deep link `/tenants/:tenantId/messaging` still works for per-tenant navigation.
- **pos-web (tenant sidebar)**: new nav item **COMMUNICATIONS → Text Messaging Setup** (managers) →
  `/tenant/communications/messaging-setup` → `POSMessagingSetupScreen` (self-service; server-derived tenant). Added to
  `EXISTING_ROUTES` so it renders the real screen, not the FeaturePage placeholder.

Verified: api **2894/2894 across 450 files**, pos-web **321/321 across 70 files**, admin-web **726/726 across 121
files** (tsc 0, all three builds clean, lint clean). Migrations 301–311 unchanged.

## Slice 23 — "Send test SMS" credential verification (both surfaces)
Lets you confirm a tenant's Twilio credentials actually work before going live — sends a real message through THAT
tenant's own account and reports the honest outcome.
- **Backend** `TenantMessagingCredentialsService.testSend(actor, tenantId, to)`: validates E.164 destination, reads the
  tenant's configured creds, decrypts the token, builds a `TwilioSmsSender` for that account, and sends a real test
  message. Returns `{ ok: true, sid }` on success, `{ ok: false, error }` with the actual provider error on failure, or
  `{ ok: false, reason: 'not_configured' }` when creds aren't set. Does not meter credits or touch opt-out (pure
  diagnostic). Audited (`tenant_credentials.test_send`).
- **Endpoints**: `POST /super-admin/tenants/:tenantId/messaging-credentials/test` (SuperAdminGuard) and
  `POST /tenant/messaging/credentials/test` (self-service, TenantAuthGuard + settings.edit).
- **Both screens** (admin-web + pos-web): a "Send a test message" card (shown once configured) — destination input +
  "Send test SMS" button that reports the message id on success or the real error on failure.
- **Tests**: api testSend (E.164 validation, not_configured) + admin-web UI (sends + shows message id) +
  **real-PG live-path proof**: configured creds with a fake token take the real Twilio path and return an honest
  provider error, not a fake success (TESTSEND_LIVE_OK).

Verified: api **2896/2896 across 450 files**, pos-web **321/321 across 70 files**, admin-web **726/726 across 121
files** (tsc 0, all three builds clean, lint clean). Migrations 301–311 unchanged.

## Multi-tenant Twilio — complete and self-serviceable
Configure (Super Admin or salon self-service, both sidebars) → verify (test SMS) → send (per-tenant account/number) →
receive (inbound STOP/START opt-out) → track (delivery receipts). Everything honest, encrypted, tested, and reachable
from navigation on both apps. Remaining is purely your Twilio account/A2P registration + env (PROVIDER_VAULT_KEK,
webhook URLs) per the runbook.

## Slice 24 — Contextual Twilio Setup link from tenant directory
Closes the last navigation gap: the Super Admin tenant directory row action menu now has a **Twilio Setup** entry that
jumps straight to `/tenants/:id/messaging` for that specific tenant (alongside Billing / Payment Gateway / Hardware).
The messaging screen is now reachable three ways: sidebar (with tenant selector), this per-tenant action, and the
deep-link route. Verified: admin-web **726/726** (TenantsScreen 16/16, tsc 0, build clean, lint clean).

## Slice 25 — LLM refinement for drafting (activates when an AI key is set)
Wires the deterministic message drafts through the existing `AiAssistantService` so they become genuinely LLM-polished
the moment an AI provider key is configured — with an honest deterministic fallback until then.
- **`draftMessage`** now builds the deterministic template first (always available), then calls `refineDraft`.
  `refineDraft` runs the draft through `AiAssistantService.run({ packageCode: 'ai_reception_copilot',
  action: 'copilot_draft_refine', … })` with a tight prompt (warm/professional/concise, keep real appointment details,
  invent nothing, return only the message). It uses the LLM text ONLY when a real provider responded
  (`usage.provider !== 'mock'`); a mock response (no key), a package/subscription block, or a provider error all fall
  back to the deterministic draft. Fail-soft throughout.
- **`cleanSmsDraft`** (pure): strips wrapping quotes, collapses whitespace, caps length; returns null if unusable.
- **Result** carries `refined: boolean`. **pos-web** shows a subtle "✨ AI-polished" hint on the message field when a
  draft came back refined. `AiAssistantService` injected `@Optional()` so existing manual constructions/tests are
  unaffected.
- **Tests**: 6 new (cleanSmsDraft strip/collapse/cap/empty; draft keeps deterministic with no AI, with mock provider,
  and on provider error; uses LLM text when a real provider responds).

### Owner step
Set an AI provider key (`OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY`, optional
`AI_DEFAULT_PROVIDER`/`AI_DEFAULT_MODEL`) and ensure the tenant has the `ai_reception_copilot` package. Drafts then
come back LLM-polished automatically; intent detection stays deterministic by design (per-keystroke LLM calls would be
wrong).

Verified: tsc 0 (api + pos-web); api + pos-web builds clean; changed area green — ai-center + ai **165/165**, messaging
cluster (ai-center/notifications/messaging-inbound/tenant-messaging) **101/101**, pos-web **321/321**; lint clean. The
change is additive and isolated to the copilot context service (optional dep + new method + pure helper). Full api
suite confirmed green: **2902/2902 across 450 files** (2896 baseline + 6 new).

## Slice 26 — Per-tenant webhook signature verification (correctness fix)
Closes a real gap created by per-tenant credentials (Slice 21): the inbound + status webhooks verified the Twilio
signature against the shared `TWILIO_AUTH_TOKEN`, so a salon running on its OWN Twilio account (whose callbacks are
signed with that salon's token) would have failed verification — its STOP/opt-out and delivery receipts silently
dropped.
- **`resolveVerificationToken(accountSid)`**: Twilio includes the sending `AccountSid` on every callback. If it matches
  a tenant's configured account (`tenant_messaging_credentials.account_sid`), verify with that tenant's decrypted token;
  otherwise fall back to the shared `TWILIO_AUTH_TOKEN`. Both `handleInbound` and `handleStatus` now use it. Secure: a
  spoofed AccountSid doesn't help an attacker — they still can't produce a valid signature without the real token.
  Fail-soft: undecryptable/lookup error → shared token.
- **Tests**: fallback unit test (no account match → shared token) + **real-PG proof** (`PERTENANT_VERIFY_OK`): a webhook
  signed with the salon's own token verifies via that token while a different global token correctly fails.

Verified: api **2903/2903 across 450 files** (exit 0, tsc 0, build clean, lint clean); frontends unchanged
(pos-web 321, admin-web 726). Migrations 301–311 unchanged.

This makes per-tenant Twilio accounts correct end-to-end: send (own account/number) → receive (STOP verified with own
token) → track (receipts verified with own token).

## Slice 27 — A2P 10DLC ISV registration automation (runbook §2)
Automates the salon-by-salon A2P journey under the ISV (AIPowerSalon) Twilio account, driven from Super Admin, against
Twilio's real APIs (verified vs current docs 2026).
- **Migration 312** `tenant_a2p_registrations`: per-tenant inputs (Secondary Customer Profile + A2P profile bundle SIDs,
  brand type, mock flag, campaign content) and outputs (brand_sid/status, messaging_service_sid, campaign_sid/status,
  number_sid, overall status, last_error).
- **`TwilioA2pClient`** (dependency-free REST, injectable http): `createBrand`/`getBrand`
  (`messaging.twilio.com/v1/a2p/BrandRegistrations`), `createMessagingService` (`/v1/Services`),
  `createCampaign`/`getCampaign` (`/v1/Services/{MG}/Compliance/Usa2p`, includes the now-required `PrivacyPolicyUrl` +
  `TermsAndConditionsUrl`, arrays as repeated keys), `attachNumber` (`/v1/Services/{MG}/PhoneNumbers`). Supports
  Twilio's `Mock=true` for fee-free dry runs.
- **`TenantA2pService`**: saves inputs, then submits Brand → (Messaging Service +) Campaign → attaches number, storing
  every SID + status and advancing a pure `deriveOverallStatus`. Uses the ISV primary account (`TWILIO_ACCOUNT_SID` /
  `TWILIO_AUTH_TOKEN`). Honest: no ISV creds → reports it and fabricates no SIDs; enforces Twilio's ordering (brand must
  be APPROVED before campaign). Audited.
- **Super Admin** `GET/PUT/POST /super-admin/tenants/:tenantId/a2p[...]` (SuperAdminGuard) + **admin-web** screen
  `A2P 10DLC Registration` (sidebar + tenant-directory action + deep link): collects bundle SIDs and campaign content,
  Mock toggle, submit/refresh buttons, a progress rail, and surfaces the ~10–15 day review as status.
- **Tests**: 6 api (pure status walk incl. failures; client shapes the real Brand + Campaign requests with policy URLs
  and repeated MessageSamples keys; readable Twilio error; honest not-configured with no fabricated SID) + 2 admin-web
  + real-PG state round-trip (`A2P_STATE_OK`: inputs + JSONB samples persist, write path works, no creds → honest error,
  no SID).

### Honest scope
This automates the **Brand → Campaign → Messaging Service → number** steps (the messaging.twilio.com A2P API). The
prerequisite **Secondary Customer Profile + A2P profile bundles** are created first in the Twilio Console/TrustHub and
their SIDs pasted in (full TrustHub EndUser/SupportingDocument/Evaluation automation is a separate, larger effort).
Live execution needs the ISV Twilio account + approved Primary Profile + each salon's business/tax info; I verified the
API shapes and the state machine but cannot run a live TCR registration from here — Mock mode is provided for dry runs.

Verified: api **2909/2909 across 451 files** (exit 0, tsc 0, build clean, lint clean); admin-web builds clean, A2P + Tenants
screens green; migrations 301–312 apply in sequence; pos-web unchanged.

## Slice 28 — TrustHub Secondary Customer Profile + A2P profile automation (completes runbook §2)
Automates the prerequisite half of the ISV flow that Slice 27 left to the Console: creating each salon's Secondary
Customer Profile and A2P profile bundle in TrustHub, then feeding the resulting BU SIDs into the Brand step.
- **Migration 313**: `business_info` (JSONB) + `secondary_profile_status` + `a2p_profile_status` on
  tenant_a2p_registrations.
- **`TwilioTrustHubClient`** (dependency-free REST, verified vs Twilio TrustHub docs 2026): createCustomerProfile,
  createBusinessInfoEndUser (`Type=customer_profile_business_information`), createAuthorizedRep
  (`authorized_representative_1`), createAddress (2010-04-01 Addresses) + createAddressSupportingDocument
  (`customer_profile_address`), assignToCustomerProfile (EntityAssignments), evaluate, submit (`Status=pending-review`);
  and the A2P TrustProduct equivalents (createTrustProduct, createA2pMessagingEndUser, assign, evaluate, submit). The
  two fixed Policy SIDs are documented, env-overridable constants (`TWILIO_SECONDARY_PROFILE_POLICY_SID` /
  `TWILIO_A2P_POLICY_SID`).
- **`TenantA2pService.provisionSecondaryProfile`**: runs the full sequence (customer profile → business-info +
  auth-rep end users → address + supporting doc → assign all entities incl. the ISV Primary Profile → evaluate →
  submit; then the A2P TrustProduct), storing both BU SIDs + statuses. Honest: needs ISV creds + `TWILIO_ISV_EMAIL` +
  `TWILIO_PRIMARY_PROFILE_SID` + complete business info; on any failure records the real Twilio error and fabricates no
  SID; stops on a noncompliant evaluation. `saveBusinessInfo` persists the collected fields.
- **Super Admin** `PUT .../a2p/business-info` + `POST .../a2p/provision-profile`; **admin-web** A2P screen gains a
  "0 · Business profile (TrustHub)" card (legal name, EIN, address, industry, authorized rep) with Save + Create
  secondary profile, and shows secondary/A2P profile status. On success the bundle SID inputs auto-fill.
- **Tests**: 4 (TrustHub client shapes CustomerProfiles/EndUsers/Addresses/EntityAssignments with correct
  Types/attributes/policy; provision refuses honestly without ISV email/creds) + real-PG (`TRUSTHUB_STATE_OK`: business
  info persists; provision with no creds fails honestly with no bundle).

### Honest scope
Endpoints, resource Types, and the sequence are verified against Twilio's TrustHub docs; the two Policy SIDs and the
exact business-info Attribute keys follow current docs but MUST be confirmed against your Twilio account before a live
submission (they occasionally change and cause rejections). This cannot be live-validated from here — run it with your
ISV account + approved Primary Profile, and use Slice 27's Mock brand mode to dry-run the downstream Brand/Campaign.

Verified: api **2913/2913 across 451 files** (exit 0, tsc 0, build clean, lint clean); admin-web builds clean, A2P screen
green; migrations 301–313 apply in sequence; pos-web unchanged.

## Full ISV A2P flow now automated end to end (in code)
Business profile (Secondary CP + A2P bundle, Slice 28) → Brand → Campaign → Messaging Service → number (Slice 27),
driven from Super Admin, honest + fee-safe (Mock), against Twilio's real APIs. Live execution + Policy/field
confirmation are the owner steps.

## Slice 29 — Messaging environment readiness (make the env config verifiable)
Setting env vars + Twilio webhooks is ops work I can't do from the repo — so I built the thing that makes it correct and
checkable: a Super Admin readiness check + a documented env template.
- **`.env.example`** extended with the full messaging var set (TWILIO_ACCOUNT_SID/AUTH_TOKEN/FROM,
  TWILIO_STATUS_CALLBACK_URL, PROVIDER_VAULT_KEK, and the A2P vars) with inline guidance and the two webhook paths.
- **Pure `evaluateMessagingReadiness`**: given only presence/length/safe values (never secrets), returns overall
  ready/partial/not_configured, a per-item checklist (E.164 from-number, PROVIDER_VAULT_KEK ≥32 chars, ISV Primary
  Profile SID shape, etc.), and the exact inbound + status webhook URLs rendered from the public API base.
- **`MessagingReadinessService`** reads env (only booleans + KEK *length* + the non-secret from-number/base URL — never
  the auth token or KEK value) → **`GET /super-admin/messaging/readiness`** (SuperAdminGuard).
- **admin-web** `Messaging Environment` screen (sidebar): status dot, the configuration checklist with required/optional
  flags and fix-it hints, and copy-able webhook URLs to paste into Twilio (with a note that per-tenant-account salons
  set the same paths — signatures verify with their own token).
- **Tests**: 6 evaluator (overall states, E.164 + KEK-length checks, webhook rendering, Primary Profile SID shape, no
  secrets in the input surface) + 1 admin-web screen.

Verified: api **2919/2919 across 452 files** (exit 0, tsc 0, build clean, lint clean); admin-web builds clean, screen
green; pos-web unchanged. No new migration.

### What's actually left for the owner
Set the env vars in your hosting and point each Twilio number's inbound + status webhooks at the two paths — the
readiness screen confirms each item and shows the exact URLs. Everything buildable in the repo for the messaging +
Copilot + A2P system is now done.

## Slice 30 — Per-tenant number provisioning (buy + register, both surfaces)
Buy a number per salon (or register one it already owns) so send / inbound routing / receipts all key off it — reusing
the registry (Slice 18), sender resolver (Slice 20), and per-tenant credentials (Slice 21). No new migration.
- **`TwilioNumbersClient`** (dependency-free REST): `searchLocal` (AvailablePhoneNumbers/{country}/Local.json,
  SmsEnabled) + `purchase` (IncomingPhoneNumbers.json, sets `SmsUrl` to the inbound webhook).
- **`TenantNumberService`**: resolves the account to buy under — the salon's OWN configured Twilio account (decrypted
  creds) if present, else the shared ISV account. `search`, `buyAndRegister` (purchase → wire inbound webhook →
  register into tenant_messaging_numbers → for own-account salons sync credentials.from_number), `registerExisting`,
  and `get` (current registered number + which account). Honest: no account → not_configured, no fabricated number;
  E.164 validated.
- **Endpoints**: super-admin `GET .../number`, `.../number/search`, `POST .../number/buy`, `.../number/register`; and
  self-service `/tenant/messaging/number[...]` (settings.edit for writes). 
- **UI**: a Phone number section on BOTH Twilio Setup screens (admin + pos-web) — shows the current number + account,
  search by area code, buy, or register an existing number.
- **Tests**: 6 (client shapes search + purchase-with-SmsUrl + readable error; service honest not_configured on search
  and buy; E.164 validation) + real-PG (`NUMBER_OK`: register upserts into the registry AND syncs the own-account
  from-number; view reflects it) + admin/pos screen tests still green.

Once registered: send resolves the from (Slice 20), inbound STOP routes by To (Slice 18), receipts match by sid
(Slice 19) — all automatically. Live purchase needs a funded Twilio account; honest not_configured otherwise.

Verified: api **2925/2925 across 454 files** (exit 0, tsc 0, build clean, lint clean); pos-web **321/321**; admin-web
builds clean; migrations unchanged (301–313).

## Slice 31 — AI readiness + cross-instance cache (Redis) [runbook §8, honest subset]
Two halves of the request, built where there's real, testable code — and honest about the rest.

### AI provider readiness (drafts → LLM-polished)
The LLM draft-polish wiring already exists (Slice 25: activates when a provider key is set). This adds the check that
makes it verifiable:
- **Pure `evaluateAiReadiness`**: from provider-key presence only (never the keys), reports overall ready/not_configured,
  the provider that will be used (openai → anthropic → gemini priority), whether drafts will be polished, and that the
  `ai_reception_copilot` package is available. not_configured is degraded-but-functional (drafts fall back to templates).
- **`AiReadinessService`** reads env (booleans only) → **`GET /super-admin/ai/readiness`** (SuperAdminGuard); surfaced as
  an "AI Reception Copilot" card on the Messaging Environment screen.
- Tests: 4.

### Cross-instance cache (Redis) — runbook §8
Mirrors the proven `login-throttle-redis` seam:
- **`CachePort`** + **`InMemoryCache`** (per-process default, namespace-versioned invalidation) + **`RedisCache`**
  (version counter in Redis via INCR so an invalidate on one node is seen by all; data keys carry a PX TTL). `ioredis`
  wired lazily via the shared `makeIoredis` only when `REDIS_URL` is set.
- Wired into **`CopilotSettingsService`** as an OPTIONAL injected port: with `REDIS_URL` the settings cache is shared +
  invalidations propagate across nodes; without it, the existing per-process cache is used unchanged (all prior tests
  green).
- Tests: 4, incl. two `RedisCache` instances sharing one fake Redis (= two API nodes) proving a write on node A is read
  on node B and an invalidate on A clears the stale read on B.

### Honest note on the rest of §8
- **Per-tenant rate quotas already exist**: `tenant_messaging_limits` (monthly/daily SMS/email/push + soft/hard/approval
  enforcement in the send pipeline) and the AI package's per-tenant `includedUsageLimit`. Not rebuilt.
- **Connection pooling** is already handled by pg/Kysely (tunable via env in deployment).
- **Read replicas** need real replica infrastructure — a deployment concern, not application code; not faked.
- **`audit_events` partitioning** is a real but heavy migration (recreate + backfill the live table under a maintenance
  window). I can build it as a deliberate, tested migration next rather than auto-applying something risky here.

Verified: api **2933/2933 across 456 files** (exit 0, tsc 0, build clean, lint clean); admin-web builds clean, screen
green; pos-web unchanged. No new migration.

## Slice 32 — audit_events partitioning (runbook §8, the deliberate one)
The last §8 item with real, testable code — built the careful way I promised: the risky convert-in-place is a DELIBERATE
maintenance operation (not auto-applied), and the ongoing partition upkeep is safe, idempotent, wired code.
- **`db/maintenance/audit_events_partition.sql`** (NOT in db/migrations/, so `migrate.mjs` never auto-runs it):
  converts audit_events to a monthly RANGE-partitioned table by occurred_at in one transaction — renames the original
  aside, recreates the table with PK `(id, occurred_at)`, recreates all six indexes on the parent (cascade to
  partitions), creates monthly partitions across the legacy data range + a DEFAULT catch-all, and backfills. Guarded
  (errors if already partitioned), rolls back cleanly on failure, keeps the legacy copy until the operator verifies
  counts and drops it. Header flags the maintenance window + batching for very large tables.
- **`audit-partitions-core.ts`** (pure): partitionName, partitionBounds (half-open, rolls Dec→Jan), upcomingMonths,
  ensurePartitionSql.
- **`AuditPartitionService`**: `ensureUpcoming(ahead)` creates the current + next N months' partitions with IF NOT
  EXISTS — but ONLY when audit_events is actually partitioned (checks pg_partitioned_table); otherwise a safe no-op.
  Runs once on boot (`onModuleInit`, best-effort, never throws into boot) so partitions always stay ahead of writes.
- **Tests**: 6 unit (naming/bounds/month-math/DDL; no-op without DB and when not partitioned) + real-PG proof of the
  full conversion: 5 rows across 3 months + an out-of-range row → partitioned=true, counts match, rows routed to the
  right monthly partitions, index recreated, EXPLAIN shows **partition pruning** (a one-month query touches only that
  month's partition), and the helper idempotently adds future months.

Verified: api **2939/2939 across 457 files** (exit 0, tsc 0, build clean, lint clean); conversion confirmed OUTSIDE the
auto-migrate glob; frontends unchanged.

## Runbook §8 status (honest, final)
- ✅ Cross-instance cache (Redis) — Slice 31.
- ✅ Per-tenant rate quotas — already existed (`tenant_messaging_limits` + AI package usage limits).
- ✅ audit_events partitioning — this slice (deliberate conversion + idempotent upkeep).
- ⛴ Connection pooling — handled by pg/Kysely; env-tunable at deploy.
- ⛴ Read replicas — genuine infrastructure (replica servers + a read/write router at deploy); no honest code artifact
  to build in-repo without the replicas existing.

## Consolidated go-live runbook
Produced `MESSAGING_A2P_GO_LIVE_RUNBOOK.md` — a single authoritative operator checklist tying together the whole arc:
env vars (§1), Twilio webhooks (§2), readiness verification (§3), per-tenant credentials + number provisioning + test
SMS (§4), A2P registration Mock-first flow (§5), the live-loop validation round-trip (§6), and §8 scale hardening incl.
the deliberate audit_events partitioning steps (§7), plus an endpoint/migration reference and an owner-only checklist.
Every endpoint path, admin route, env var, and migration number was cross-checked against the code before publishing.
