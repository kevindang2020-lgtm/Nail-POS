# AI Receptionist Center — honest status + first tenant-facing slice (2026-07-04)

## Premise correction
The pasted spec (two documents, ~32 tenant-facing pages + workflow canvas + live provider integration) assumes the
receptionist is unbuilt. The **backend spine already exists and is tested** from prior sessions: the Booking Gateway
(nine endpoints, idempotency, error taxonomy, buffer-aware availability, handoff), the call-outcome store, the
human-approved learning/knowledge pipeline, tenant-scoped analytics, gateway health metrics, the Retell function
schemas + agent prompt + go-live runbook, and the Super Admin (admin-web) receptionist screen. This phase begins the
**tenant-facing** frontend the spec describes.

## What I built this pass (real, wired, tested)
A tenant-facing **AI Receptionist workspace entry + Command Center** in pos-web, wired to a new tenant-scoped read API:
- `apps/api/.../tenant-receptionist.service.ts` + `.controller.ts` — `GET /tenant/ai/receptionist/overview` and
  `/calls` behind `TenantAuthGuard` (scope server-derived from the session, never the client). Reuses the REAL
  services: `VoiceCallOutcomeService` (analytics + recent calls), `VoiceKeyService` (whether a key is issued),
  `VoiceBranchInfoService` (store-hours → business-setup readiness), and the write-tools flag. 5 unit tests.
- `apps/pos-web/.../POSAIReceptionistScreen.tsx` — the Command Center: live metrics (calls, booking/handoff/abandon
  rates, avg duration) from real outcomes, a setup checklist with real progress, a Connections panel, and a recent-
  calls table with an honest empty state. Champagne Gold via the existing pos-web tokens (#A96F22 gold, Playfair
  heads, #FFFCF6 cards) — consistent with the rest of the app. Routed at `/tenant/ai/receptionist`, nav item added
  under AI CENTER, nav-wiring invariants updated. 1 screen test.
- Fixed a pre-existing unhandled-error flake (jsdom `scrollIntoView` stub in the pos-web test setup) — the suite now
  exits clean.

## Honesty about what is NOT built, and why
The spec's own rule is "no fake buttons, no simulated progress, everything wired to real Retell/Twilio." Several large
pieces genuinely cannot be truly wired yet and I refuse to fake them:
- **Live provider provisioning** — creating a Retell agent, buying/porting a Twilio number, and placing a real
  browser (WebRTC) test call — requires accounts, credentials, and SDKs that don't exist in this environment. The
  Command Center therefore shows providers in their **true not-connected state** with a plain "connect an account"
  note, not a fake "Live" badge or a timer-driven progress bar. These are the go-live steps in
  `docs/ai-receptionist/GO_LIVE_RUNBOOK.md`.
- The remaining ~30 pages (Front Desk agent list, Create-Agent wizard, durable provisioning job + progress modal,
  visual workflow canvas + node settings, Test Audio/Chat consoles, Business Setup, the receptionist Calendar, Phone
  Number, Calls detail, Follow-Ups, Google Reviews, and the full Settings tree) are a multi-phase build. I won't
  claim they exist when they don't.

## Suggested phase order (each fully wired, no fakes)
1. **(done)** Tenant workspace entry + Command Center over real data.
2. Front Desk **agent list + Create-Agent wizard as a DRAFT/config flow** — real persistence (new `ai_receptionist_
   agents` + versions tables), reusing Business Setup/Calendar data for the knowledge snapshot; provisioning to Retell
   left as an explicit "connect account" step.
3. **Calls list + detail** and **Follow-Ups** — both already have real backing data (call outcomes); pure frontend +
   thin tenant endpoints.
4. **Business Setup** + **receptionist Calendar** — reuse the existing booking/settings data (no second calendar).
5. **Settings tree** — persist to real config; reuse existing booking/notification settings as source of truth.
6. Provider-live layer (**Retell provisioning job, Twilio phone, Test consoles, Reviews**) — built when the accounts
   exist; until then these render honest "connect account" states.
7. Workflow canvas — last, as a controlled node editor over the agent config.

## Verification (fresh, all green)
api **2741/2741 across 429 files** (tsc 0, build clean, lint clean); pos-web **304/304 across 65 files** (tsc 0,
build clean, suite exits clean after the flake fix). New this pass: 5 service tests + 1 screen test.

## Phase 2 — Front Desk agent list + Create-Agent draft flow (2026-07-04, second pass)

Built the next wireable chunk: real agent management as a config/draft lifecycle (no provider account required).

- **Migration 302** — `ai_receptionist_agents` (tenant/branch scoped; status draft|ready|live|paused|error|archived;
  provider_agent_id NULL until connected) + `ai_receptionist_agent_versions` (immutable config snapshots, unique
  (tenant, agent, version)). Applied to real Postgres; proved tenant isolation (a tenant sees only its own agents,
  cross-tenant read is empty), version snapshotting, and the unique-version guard.
- **`ai-agent-core.ts`** — pure validation, safe greeting/behavior defaults, and a DRAFT-ONLY status machine: an
  agent cannot reach 'ready'/'live' without provider provisioning, so the honest boundary is enforced in code, not
  just the UI.
- **`ai-agent.service.ts`** — permission-gated CRUD ('ai.manage' for writes), kysely + in-memory repos, version
  snapshot on every create/update. Cross-tenant get → NotFound.
- **Tenant endpoints** on the existing receptionist controller: `GET/POST /tenant/ai/receptionist/agents`,
  `GET/PATCH /agents/:id`, `POST /agents/:id/status` (TenantAuthGuard, server-derived scope).
- **`POSAIFrontDeskScreen.tsx`** — the agent list (status filters + counts) with an inline Create-Agent draft form
  (name, use case, call type, language), status actions (pause/resume/archive), honest empty states, and a plain
  note that going live needs a connected provider. Routed at `/tenant/ai/receptionist/front-desk`, nav item added,
  Command Center links to it. Champagne Gold via existing tokens.

Tests: 8 agent core/service unit tests + 2 Front Desk screen tests. Honest boundary held — no status can be forced to
'live', and provider fields stay null.

Fresh, all green: api **2749/2749 across 430 files** (tsc 0, build clean, lint clean); pos-web **306/306 across 66
files** (tsc 0, build clean, suite exits clean).

## Still account-gated / later phases (unchanged)
Provider provisioning (Retell agent create, Twilio number, live/WebRTC test call) — needs your accounts; agents stay
drafts until then. Remaining pages: Calls detail, Follow-Ups, Business Setup, receptionist Calendar, Settings tree,
Reviews, workflow canvas — each buildable as real+honest slices in the order in this doc.

## Phase 3 — Follow-Ups + handoff auto-creation (2026-07-04, third pass)

Built the operations queue that turns AI handoffs into actionable staff tasks, plus manual follow-ups.

- **Migration 303** — `ai_receptionist_follow_ups` (tenant/branch scoped; reason, priority, status open|assigned|
  in_progress|waiting|resolved|closed; references customer/appointment/call by id; source manual|ai_receptionist).
  A **partial unique index** on (tenant_id, provider_call_id) WHERE still open prevents a retried handoff from stacking
  duplicate callbacks. Applied to real Postgres; proved: two concurrent handoff callbacks for the same call collapse
  to exactly one open follow-up, and a resolved call allows a fresh one.
- **`ai-follow-up.service.ts`** — permission-gated writes ('ai.manage'), status machine, createManual, assign,
  addNote (appends), setStatus (with resolution), and `createFromHandoff` (idempotent per open call). Kysely +
  in-memory repos.
- **Gateway integration** — the Booking Gateway's `handoff` endpoint now, when no live transfer destination exists,
  creates a CALLBACK follow-up (idempotent, inside the existing idempotency wrapper so replays don't double-create)
  and returns its id as `referenceId`. Both gateway harnesses (unit + e2e) updated; a new assertion proves the
  callback path creates the follow-up. No prior gateway behavior changed.
- **Tenant endpoints**: `GET/POST /tenant/ai/receptionist/follow-ups`, `POST .../:id/assign`, `.../:id/note`,
  `.../:id/status` (TenantAuthGuard, server-derived scope).
- **`POSAIFollowUpsScreen.tsx`** — the queue: status filters, create-manual form, assign/note/resolve actions, an
  "from AI" marker on AI-created rows, and honest empty states. Routed at `/tenant/ai/receptionist/follow-ups`, nav
  item added, Command Center links to it (and its dead "View calls" link was repointed here). Champagne Gold tokens.

Tests: 6 follow-up service tests + 2 screen tests + 1 new gateway assertion. Real-PG dedupe proof included.

Fresh, all green: api **2755/2755 across 431 files** (tsc 0, build clean, lint clean); pos-web **308/308 across 67
files** (tsc 0, build clean, suite exits clean).

## Remaining (unchanged): Business Setup, receptionist Calendar (reuse existing booking data), Settings tree, Calls
## detail, Reviews, workflow canvas; and the provider-live layer (Retell/Twilio) which still needs your accounts.

## Phase 4 — Business Setup + receptionist Calendar (2026-07-04, fourth pass)

Built the two reuse-heavy pages. The discipline here was NOT duplicating data: services, hours, technicians, and
appointments are all read from their existing sources. The only new data is customer-facing FAQs.

- **Migration 304** — `ai_receptionist_faqs` (tenant/branch scoped; approved Q&A the AI may answer; is_active toggle
  so staff control exactly what the AI can say). Applied to real Postgres. This is genuinely new data, not a copy of
  services/hours/policies.
- **`ai-faq.service.ts`** — permission-gated CRUD ('ai.manage'), validation, active toggle, tenant isolation; kysely
  + in-memory repos. 4 unit tests. Endpoints: `GET/POST /tenant/ai/receptionist/faqs`, `PATCH/DELETE .../faqs/:id`.
- **`POSAIBusinessSetupScreen.tsx`** — a readiness view that READS the salon's real data: store-hours state (from the
  receptionist overview), live service count (existing `posServicesApi`), and technician count (existing
  `posTechniciansApi`), each with an Edit deep-link to the real management screen. Plus full FAQ management. Nothing
  is copied — the note says the receptionist always uses the live source.
- **`POSAICalendarScreen.tsx`** — the receptionist Calendar, explicitly NOT a second calendar: it reuses the exact
  same `posBookingApi.dayGrid(date)` the POS Booking screen uses, as a read-focused day view (date nav, day summary,
  per-tech availability, appointment list) that highlights AI-created bookings by their `source`. All create/edit/
  drag-drop stays in POS Booking via a deep link — no duplicate mutation logic, the schedule stays single-source.
- Both routed + nav items added; Command Center links to both. Champagne Gold via existing tokens.

Tests: 4 FAQ service tests + 2 screen tests (Business Setup readiness/FAQ, Calendar reuse + AI marking). Real-PG FAQ
insert verified.

Fresh, all green: api **2759/2759 across 432 files** (tsc 0, build clean, lint clean); pos-web **310/310 across 68
files** (tsc 0, build clean, suite exits clean).

## Remaining
Settings tree (persist to real config) and Calls detail are still buildable now. Provider-live layer (Retell agent
provisioning, Twilio phone, WebRTC test console, Google Reviews) stays honest "connect account" until your accounts
exist and the go-live runbook is walked.

## Phase 5 — Settings + Calls detail (2026-07-04, fifth pass)

Built the Settings tree and a real Calls page with a detail drawer. Reuse discipline again: Settings owns only
receptionist-level config and links out to the existing Booking/Notification screens; Calls detail renders over the
real outcome record and is honest about what isn't stored.

- **Migration 305** — `ai_receptionist_settings` (one JSONB row per tenant/branch scope). Holds ONLY receptionist
  settings (enable, default language, after-hours behavior, interruption/silence, max duration, recording + consent).
  Booking rules and notification prefs are NOT copied here. Applied to real Postgres.
- **`ai-settings.service.ts`** — get-with-defaults + validated patch that **rejects unknown keys and out-of-range
  values** (so the JSONB can't become an arbitrary bag), permission-gated ('ai.manage'), kysely + in-memory repos.
  5 unit tests.
- **Call detail** — added `GET /tenant/ai/receptionist/calls/:providerCallId` returning the full outcome record via
  the existing `VoiceCallOutcomeService.get`. No new storage.
- **`POSAICallsScreen.tsx`** — Calls list + detail drawer over the real record (intents, tool calls with ok/fail
  chips, booking/handoff outcome, sentiment, follow-up flag, summary). **Honest**: transcript/recording aren't
  captured by the outcome store, so the drawer says so plainly instead of showing a broken player. Corrected the
  call field names (startedAt/createdMs) here and on the Command Center.
- **`POSAISettingsScreen.tsx`** — General, Conversation, and Recording&Consent sections that persist real settings,
  a save flow with a "Saved" confirmation, and a "Uses your existing settings" section linking to Booking rules,
  Notifications, and Business Setup rather than duplicating them. No legal claims — a plain note that consent rules
  vary by state.
- Both routed + nav items added; Command Center links to both.

Tests: 5 settings service tests + 2 screen tests. Real-PG settings upsert verified.

Fresh, all green: api **2764/2764 across 433 files** (tsc 0, build clean, lint clean); pos-web **312/312 across 69
files** (tsc 0, build clean, suite exits clean).

## Tenant-facing status
Command Center, Front Desk agents, Business Setup + FAQs, Calendar, Calls + detail, Follow-Ups, and Settings are all
real, wired, and tested. The tenant-facing workspace is complete **except for the provider-live layer**: Retell agent
provisioning, the Twilio phone number, the live/WebRTC test console, and Google Reviews. Those stay honest "connect
account" states and cannot be truly built until the Retell/Twilio accounts exist and the go-live runbook is walked.

## Phase 6 — Provider seam + integration spec (2026-07-04, sixth pass)

Instead of faking the provider-live layer, built the real seam it plugs into and made the "connect account" states
honest-by-construction.

- **`provider-ports.ts`** — `VoiceProviderPort` (Retell) and `TelephonyProviderPort` (Twilio) interfaces defining the
  exact operations provisioning/phone/test-console will call, plus honest `NotConnected` defaults: `status()` returns
  a **credential-derived** reason (distinguishing "creds missing" from "creds set but adapter not enabled"), and every
  action throws `ProviderNotConnectedError`. There is no simulated success and no simulated progress anywhere.
- **Overview now derives provider status from the seam** (`resolveVoiceProvider(env).status()` /
  `resolveTelephonyProvider(env).status()`) instead of a hardcoded `'not_connected'` literal. The day a live adapter
  and credentials exist, the Command Center flips to `connected` truthfully with no UI change. The Command Center now
  shows the specific reason (e.g. "RETELL_API_KEY is not configured").
- **`docs/ai-receptionist/PROVIDER_INTEGRATION.md`** — implementation-ready spec mapping each of the four remaining
  screens (provisioning job, phone number, test console, reviews) to exact port operations, env vars, the knowledge-
  snapshot contract, and the go-live sequence. The only remaining code once accounts exist is a single live adapter
  implementing the two ports.

Tests: 5 provider-port tests (honest status + actions throw). Existing overview test updated for the richer provider
shape.

Fresh, all green: api **2769/2769 across 434 files** (tsc 0, build clean, lint clean); pos-web **312/312 across 69
files** (tsc 0, build clean, suite exits clean).

## Final tenant-facing status
Every screen that can be truly wired without provider accounts is built, wired, and tested: Command Center, Front Desk
agents, Business Setup + FAQs, Calendar (reuses POS booking data), Calls + detail, Follow-Ups, and Settings. The
provider-live layer (Retell provisioning, Twilio phone, WebRTC test console, Google Reviews) has a real, tested seam
and an implementation-ready spec; it needs the accounts + a single live adapter, not more scaffolding.

## Phase 7 — Live Twilio telephony adapter (2026-07-04, seventh pass)

Built the real Twilio adapter — the first of the "single live adapter" pieces — verified against Twilio's current
REST API (checked the live docs rather than relying on memory).

- **`twilio-telephony.provider.ts`** — `TwilioTelephonyProvider implements TelephonyProviderPort`. Real HTTP against
  the Twilio 2010-04-01 REST API: `searchNumbers` (GET AvailablePhoneNumbers/{country}/{Local|TollFree}.json,
  VoiceEnabled), `purchaseNumber` (POST IncomingPhoneNumbers.json, sets the inbound VoiceUrl), `assignNumber` (POST
  IncomingPhoneNumbers/{sid}.json tagging the voice webhook with the agent id), `releaseNumber` (DELETE). HTTP Basic
  auth (AccountSid:AuthToken); fetch is injectable for testing; Twilio error bodies map to `TwilioApiError` with the
  Twilio error code. `status()` never leaks the auth token.
- **`resolveTelephonyProvider(env)`** now returns the LIVE adapter when `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN`
  are set (and `AI_RECEPTIONIST_VOICE_WEBHOOK_URL` for the inbound route), and the honest NotConnected default
  otherwise. So with no creds there are no real calls and no accidental spend; the day Kevin sets creds, the phone
  path works with zero call-site changes.
- 8 adapter tests (correct requests/auth, response parsing, assign tagging, DELETE release, error mapping, VoiceUrl
  guard) + resolver wiring test, all with a mocked fetch (no real account, no spend).

Fresh, all green: api **2777/2777 across 435 files** (tsc 0, build clean, lint clean). pos-web unchanged this pass
(**312/312**).

## Remaining live adapter: Retell (voice)
The Twilio side is done. The Retell voice adapter (createAgent/updateAgent/registerWebhook + web-call session for the
test console) is the last piece; it needs a Retell account to exercise end to end. The seam and the phone side are
ready, so that adapter plus the go-live env vars complete the path.

## Phase 8 — Live Retell voice adapter (2026-07-04, eighth pass)

Built the second and final live adapter, symmetric with Twilio. Verified against Retell's current REST API (checked
the live docs).

- **`retell-voice.provider.ts`** — `RetellVoiceProvider implements VoiceProviderPort`. Real HTTP against
  `https://api.retellai.com` with Bearer auth. `createAgent` provisions a Response Engine (`POST /create-retell-llm`
  from the agent's behavior+curated knowledge as the prompt and the greeting as begin_message), then creates the
  agent (`POST /create-agent`) referencing it with voice_id + mapped language + webhook_url. `updateAgent` /
  `registerWebhook` use `PATCH /update-agent/{id}`; `deleteAgent` uses `DELETE /delete-agent/{id}`. Retell error
  bodies map to `RetellApiError`; `status()` never leaks the API key. fetch is injectable for testing.
- **`resolveVoiceProvider(env)`** now returns the LIVE adapter when `RETELL_API_KEY` is set (with
  `RETELL_DEFAULT_VOICE_ID` + `AI_RECEPTIONIST_VOICE_WEBHOOK_URL`), NotConnected otherwise. No key → no real calls.
- 6 adapter tests (create sequence LLM→agent, Bearer auth, language mapping, update/delete/webhook, error mapping,
  no-key-leak) with mocked fetch. Provider-ports test updated for the live-adapter behavior.

Fresh, all green: api **2782/2782 across 436 files** (tsc 0, build clean, lint clean). pos-web unchanged (**312/312**).

## Go-live code path — COMPLETE
Both live adapters exist and are tested. Required env for go-live:
`RETELL_API_KEY`, `RETELL_DEFAULT_VOICE_ID`, `RETELL_WEBHOOK_SIGNING_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
`TWILIO_FROM`, `AI_RECEPTIONIST_VOICE_WEBHOOK_URL`, `VOICE_WRITE_TOOLS_ENABLED=true`. With these set + a `vk_live_`
key issued, the provider seam flips to connected and the phone/agent operations execute against the real providers
with no call-site changes. What remains is purely operational (create the accounts, set env, run a test call) — not
code.

## Phase 9 — Durable provisioning job (2026-07-04, ninth pass)

Wired the Front Desk "Provision" action through the adapters via a durable, pollable job.

- **Migration 306** — `ai_receptionist_provisioning_jobs` (persisted status/step/progress/error). A partial unique
  index allows only ONE active (pending/running) job per agent — proven on real Postgres (a second concurrent
  insert raises unique_violation → DEDUPE_OK).
- **`provisioning-core.ts`** — the ordered steps; `create_voice_agent` is the explicit provider-call point.
- **`ai-provisioning.service.ts`** — `start()` (permission-gated, idempotent: returns the existing active job rather
  than duplicating) kicks off `run()`, which executes the steps, persists progress, and calls
  `voiceProvider.createAgent(...)` at the provider step. On `ProviderNotConnectedError` it fails HONESTLY with
  `errorCode=PROVIDER_NOT_CONNECTED` and a safe message, progress < 100 — never a fake completion. On success it sets
  the agent's `provider_agent_id` and flips draft→ready. (Execution is in-process; the job STATE is durable and
  pollable — a real worker/queue is noted as production hardening.)
- **Endpoints**: `POST agents/:id/provision` (start), `GET provisioning/:jobId` (poll).
- **Front Desk UI** — a "Provision" action on draft agents opens a progress modal that polls the job, shows the
  current step + progress bar, and on the not-connected failure explains it plainly with a Retry (the agent stays a
  draft; nothing faked).

Tests: 4 provisioning service tests (honest not-connected failure, success path flips the agent, permission, active-
job idempotency) + a Front Desk provisioning test (the honest failure surfaces with Retry). Real-PG dedupe proven.

Fresh, all green: api **2786/2786 across 437 files** (tsc 0, build clean, lint clean); pos-web **313/313 across 69
files** (tsc 0, build clean, suite exits clean).

## Complete picture
The provisioning flow now connects the whole chain: draft agent → durable job → Retell adapter → agent ready. With
no Retell key it fails honestly at the provider step; with a key it drives real provisioning. Everything that can be
built and tested without live accounts is done. Remaining = operational only (create accounts, set env, test call).

## Phase 10 — Correction: reconciled with pre-existing runtime provider (2026-07-04, tenth pass)

This pass fixed a mistake I introduced earlier rather than adding a feature — the honest thing to do.

**What I found:** the inbound call path was already complete before Phase 6. `voice-provider.port.ts` defines a runtime
`VoiceProviderPort` (verifyWebhook / parseToolCall / formatToolResult), `retell-voice.adapter.ts` implements it with
Retell's real X-Retell-Signature scheme (v=/d=, 5-min replay window, constant-time compare), and
`voice-booking.controller.ts` already verifies the signature and calls `outcomes.record(...)`. So calls ARE recorded
into the outcome store that the Command Center, Calls, and analytics read — I did not need to build a webhook.

**What I got wrong:** my Phase 6–8 provisioning abstraction named its interface `VoiceProviderPort`, colliding with
that pre-existing runtime interface. They compile fine (separate import paths) and are genuinely different concerns —
mine covers management/provisioning (createAgent, buy/assign number) which the runtime port does not — but two
identically-named interfaces in one module is the confusion the reuse invariant exists to prevent.

**Fix:** renamed my ports to `VoiceProvisioningPort` / `TelephonyProvisioningPort` across the four files that use them
(provider-ports.ts, retell-voice.provider.ts, twilio-telephony.provider.ts, ai-provisioning.service.ts), and added a
header note pointing to the runtime port. The pre-existing runtime files were not touched. No functional change; pure
disambiguation.

Fresh, all green: api **2786/2786 across 437 files** (tsc 0, build clean, lint clean).

**Net:** the inbound (webhook → record outcome) and outbound (gateway tools + handoff→follow-up) call paths both
pre-existed or were built earlier; the management/provisioning path (agents, adapters, provisioning job) is the new
layer and is now clearly named and distinct from the runtime port.

## Phase 11 — Full duplication/collision audit of my ten phases (2026-07-04, eleventh pass)

Systematic sweep of everything I added, against the existing codebase. Findings:

- **Collision (fixed):** `ai-agent-core.ts` exported `canTransition`, colliding with the pre-existing
  `voice-learning-core.ts` `canTransition` (prompt status machine). Renamed mine to `canTransitionAgent` (consistent
  with my existing `canTransitionFollowUp`) across its three files. The pre-existing function was not touched.
- **Pre-existing, not mine (left alone):** `technician_services` is created in both migration 003 and 006 with
  IF NOT EXISTS (idempotent). This predates my work and is harmless; not in scope to change early migrations.
- **Clean:** no duplicate method+path in my controller; `tenant/ai/receptionist` prefix is used only by my
  controller (no route collision); all my services/adapters are wired (no dead exports); pos-web has no duplicate nav
  ids, routes, or screen component names; migrations 301\u2013306 are sequential with no gaps.

Combined with Phase 10 (the `VoiceProviderPort` \u2192 `VoiceProvisioningPort` rename), both name collisions I introduced
across ten phases are now resolved. No functional changes in this pass \u2014 disambiguation only.

Fresh, all green: api **2786/2786 across 437 files** (tsc 0, build clean, lint clean); pos-web unchanged (**313/313**).

## Phase 12 — Tenant-isolation hardening for scale (2026-07-04, twelfth pass)

Responding to the "merge/repair + strict isolation for 10,000+ tenants" spec by inspecting my own additions rather
than rebuilding (the system already exists). Audit + fixes:

**Audited (all clean):**
- Every SELECT/UPDATE/DELETE in the receptionist repos is tenant-scoped (`WHERE tenant_id = ...`) — the multi-line
  UPDATEs were verified to carry the filter on their WHERE clause.
- Every INSERT lists `tenant_id` first (server-derived).
- The controller reads tenant/branch only from `req.ctx` (server-derived); it never accepts them from the client
  body or query.

**Fixed (scale / unbounded-query mandate):**
- The **follow-ups list was unbounded** — for a busy salon it could return thousands of rows over time. Added a
  bounded limit (default 200, max 500, most-recent-first) through the service + both repos.
- Added a defensive `LIMIT 500` to the agents and FAQs list queries too (small per tenant, but no query should be
  unbounded). Calls were already capped at 50.

**Proven:**
- New consolidated cross-tenant suite (`tenant-isolation.vitest.spec.ts`): Tenant B cannot read, edit, assign, note,
  resolve, provision, or status-change Tenant A's agents / follow-ups / FAQs / settings / provisioning jobs — reads
  return empty, mutations raise NotFound, and A's data is untouched. Plus a bounded-list assertion.
- **Real Postgres**: seeded one row per receptionist table for tenant A; tenant B's `WHERE tenant_id = B` query
  returns zero across all five stores, while A sees its own. 

Fresh, all green: api **2792/2792 across 438 files** (tsc 0, build clean, lint clean); pos-web unchanged (**313/313**).

### Architecture map (spec §1 deliverable — accurate as-built)
- Runtime call path (pre-existing): Retell webhook \u2192 `RetellVoiceAdapter.verifyWebhook` (X-Retell-Signature) \u2192
  `voice-booking.controller` \u2192 `VoiceCallOutcomeService.record`. Gateway tools + handoff\u2192follow-up (built earlier).
- Management path (built here): tenant workspace (9 pos-web screens) \u2192 `tenant-receptionist.controller`
  (TenantAuthGuard, server-derived scope) \u2192 agent/follow-up/faq/settings/provisioning services \u2192
  `VoiceProvisioningPort` \u2192 Twilio/Retell live adapters.
- Isolation: server-derived tenant/branch everywhere; every store tenant-scoped; bounded lists; proven on real PG.
- Remaining (operational, not code): create Retell/Twilio accounts, set env, issue `vk_live_` key, run a test call.

## Phase 13 — Audit logging for high-risk AI actions (2026-07-04, thirteenth pass)

Filled a genuine gap both specs call for: my receptionist write-actions weren't emitting audit events. Wired them
into the EXISTING shared `AuditService` (reuse, not a new audit system).

- `voice-booking.module` now imports `AuditModule`; the controller injects `AuditService`.
- A resilient `aud()` helper (never throws — audit must not break the request) emits `module: 'ai_receptionist'`
  events scoped to the server-derived tenant/branch, with secret-redacted metadata (handled by AuditService).
- Events emitted on the high-risk actions: `agent.created`, `agent.updated`, `agent.status_changed`,
  `agent.provision_started`, `follow_up.created`, `follow_up.status_changed`, `faq.created`, `faq.updated`,
  `faq.deleted`, `settings.updated` (records which keys changed). These flow into the existing Audit Logs surface,
  so operators can see who changed the receptionist and when.
- 3 tests confirm the event shape + server-derived scope + metadata.

Fresh, all green: api **2795/2795 across 439 files** (tsc 0, build clean, lint clean); pos-web unchanged (**313/313**).

## Phase 14 — Super Admin cross-tenant fleet oversight (2026-07-04, fourteenth pass)

Built the platform cockpit both specs asked for under "Super Admin integration" — the operational view you'll need as
you onboard salons. Extends the EXISTING super-admin/voice surface (no duplication).

- **`voice-fleet.service.ts`** — `VoiceFleetService.summary()`: cross-tenant aggregate COUNTs (tenants with agents,
  agents by status, provisioning failures, open follow-ups). This is the one place cross-tenant reads are legitimate:
  reached only via the SuperAdminGuard-protected controller, and it returns aggregates only — never one tenant's row
  data. Resilient: no DB or a query error yields an honest disconnected summary, never an exception.
- **Endpoint**: `GET /super-admin/voice/fleet` added to the existing `SuperAdminVoiceController` (injected the new
  service; `VoiceFleetService` exported from `VoiceBookingModule`).
- **admin-web**: a "Platform fleet" section on the existing `AiReceptionistScreen` (loads on mount, platform-wide),
  showing the rollup with an honest empty state; added `fleet()` + `FleetSummary` to the typed client.
- Fixed the screen's existing test (added `fleet` to its mock so the mount effect resolves).

Tests: 2 fleet service tests (honest disconnected + resilient-to-failure). **Real Postgres** proof: seeded agents
across two tenants + a failed job + an open follow-up; aggregates returned tenantsWithAgents≥2, correct by-status
counts, failures≥1, openFollowUps≥1.

Fresh, all green: api **2797/2797 across 440 files**, admin-web **722/722 across 119 files** (both tsc 0, builds
clean, lint clean); pos-web unchanged (**313/313**).

## Phase 15 — Production-readiness consolidation (2026-07-04, fifteenth pass)

Produced deliverable #40 (both specs): `docs/ai-receptionist/PRODUCTION_READINESS.md` — one authoritative go-live
reference consolidating all phases: what's built, the fresh verification matrix, the security/isolation posture, the
go-live sequence, env vars, rollback controls, honest known limitations, and a final checklist separating what's
done (code) from what's owner-operational (accounts, env, test call).

Backed by a fresh deployability proof: **migrations 301–306 apply cleanly in sequence** (ON_ERROR_STOP) on Postgres
16 and all tables land. Final green state confirmed: api 2797/2797 (440 files), pos-web 313/313 (69), admin-web
722/722 (119) — all tsc 0, builds clean, lint clean.

## Phase 16 — AI Reception Copilot: surfaced the existing assistant (2026-07-04)

The pasted spec body didn't attach (empty document), so I worked from the framing line and — per its own "inspect
first, don't duplicate" mandate — inspected before building. Key finding: the **Reception Copilot backend already
exists**. `ai-catalog.ts` defines the `ai_reception_copilot` package, `ai-prompts.ts` its system prompt, and
`AiAssistantService.run()` (tenant-isolated, package/subscription-gated, usage-logged) already serves it through a
real provider gateway (`OpenAiProvider` etc., with a `MockAiProvider` fallback when no key). So this was a
wire-and-surface task, not a new assistant.

Gap closed:
- The canonical `/ai/:packageCode` controller uses a different auth derivation than the `/tenant/ai/*` endpoints
  pos-web uses. Added a tenant-scoped `POST /tenant/ai/center/copilot` on the existing `AiCenterController`
  (TenantAuthGuard, server-derived `req.ctx`) that DELEGATES to the existing `AiAssistantService` for package
  'ai_reception_copilot' — reusing all its gating/gateway/billing, guaranteeing the same isolation as the rest of the
  build. Returns a `degraded` flag (usage.provider === 'mock') so the UI never passes a sample off as real AI.
- Built the missing staff chat UI: `POSReceptionCopilotScreen` — conversational panel with suggestion chips, honest
  states (access-denied → reason + plans link; degraded → "sample response, no AI provider configured"; loading;
  error). Routed `/tenant/ai/copilot`, nav item under AI Center, gated by `ai_reception_copilot`.

Tests: 4 endpoint tests (delegation, server-derived scope that ignores a spoofed body tenantId, degraded flag,
access-denied passthrough) + 3 screen tests.

Fresh, all green: api **2801/2801 across 441 files**, pos-web **316/316 across 70 files** (both tsc 0, builds clean,
lint clean).

## Phase 17 — Provisioning observability counters (2026-07-04)

The last genuinely-additive, no-account item. Adds success/failure *rates* over the process lifetime, complementing
the fleet view (which is a point-in-time DB snapshot of failed jobs).

- **`provisioning-metrics.service.ts`** — `ProvisioningMetricsService`, mirroring `VoiceGatewayMetricsService`:
  single-instance, since-process-start counters (attempts / succeeded / failed, by error code). Low-cardinality — no
  tenant labels — so it's safe for Super Admin. `successRatePct` is null until there are settled attempts (no
  fabricated 100%). Resets on restart, and the snapshot says so.
- Wired into `AiProvisioningService.run()` via an `@Optional()` injected dep (existing tests that construct the
  service without it still pass): `attempt()` at start, `success()` / `failure(errorCode)` at the terminal states.
- Registered as a singleton in `VoiceBookingModule` (provided under `'ProvisioningMetrics'`, injected into the
  provisioning factory, exported). Exposed via `GET /super-admin/voice/provisioning-metrics` on the existing SA
  controller.
- admin-web: a Provisioning line in the Platform Fleet section (attempts, ok/failed, success %, errors by code).

Tests: 4 (null rate initially; rate + by-error-code math; provisioning records a PROVIDER_NOT_CONNECTED failure when
not connected; records a success at 100% with a connected mock provider). Existing provisioning tests still green.

Fresh, all green: api **2805/2805 across 442 files**, admin-web **722/722 across 119 files** (both tsc 0, builds
clean, lint clean); pos-web unchanged (**316/316**).
