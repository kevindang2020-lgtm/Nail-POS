# AI Front Desk — Complete Build Guide (guide 23, Oct 31 2026)

Screen: `/tenant/ai/receptionist/front-desk` (AI Center → AI Front Desk). API: `/pos/ai/front-desk/*`.
Migration: `756_ai_front_desk_center.sql` (additive; rollback in its header; local `aps` test template only). Nothing was pushed,
deployed, called, texted or charged. No Twilio / Retell setting, agent, number, route or webhook was touched.

## 1 · Repository audit and root cause (guide §2)

| Finding (from code) | Decision |
|---|---|
| "No agents yet" was honest when the salon had no `ai_receptionist_agents` row. The old screen read `GET /tenant/ai/receptionist/agents` (unpaged, `LIMIT 500`, filtered in the browser). An API failure showed as "Failed to load agents"; an agent hidden by the filter showed as "No agents". | The directory is now server-side: search, filters, date range, numbered pages, honest empty / filtered-empty / error states, and a "hidden by filters" notice after Create. |
| **P0:** the plain status route `POST /tenant/ai/receptionist/agents/:id/status` let any `ai.manage` holder move an agent `ready → live` with no routing evidence, no owner approval, no salon activation and no record of the previous live agent. A live agent could also be paused or archived there while the salon stayed "activated" with booking armed. | `canTransitionAgent` now refuses every move into or out of `live` and out of `archived`. The five old agent routes (list / get / create / update / status) are retired: their only caller was this screen. Provisioning stays as an explicit provider action. |
| Nothing prevented two agents being live on the same salon route. | Partial unique index `uq_air_agents_one_live` (tenant + branch scope where status = live) plus a per-route advisory lock in the activation transaction. |
| Retell provider agents without a local mapping are not imported. | Kept as is. The system check reports calls answered by unknown provider agents ("Calls from unknown agents") instead of attaching them. |

Dependency inventory reused, not duplicated:
- **Salon gates** (`ReceptionistCenter`, guide 21): entitlement, salon Twilio account, inbound route, Retell key/agent, integration key, Business Setup, and the verified test call.
- **Calls and tool ledger** (`voice_call_outcomes.agent_ref`, `voice_tool_executions`, guide 22).
- **Business knowledge and approved FAQs** (`BusinessSetupCenter`, guide 20).
- **Audit:** `recordAuditStrict`.

## 2 · Implementation

| Area | Files |
|---|---|
| Migration | `apps/api/db/migrations/756_ai_front_desk_center.sql`. On `ai_receptionist_agents` it adds `description`, `config_version`, `wizard_step` (1–8) and `wizard_state`, `booking_mode` (handoff_only / eligible), `handoff_destination`, `after_hours_message`, and `activated_at/_by`, `paused_at`, `last_verified_at`. It adds the append-only `ai_receptionist_agent_events` (a trigger refuses UPDATE/DELETE). It creates `uq_air_agents_one_live` only when existing data already satisfies it. `ai_receptionist_health_runs` gains `scope` + `agent_id`. Applied twice (idempotent). |
| Backend, new | `modules/ai/src/voice-booking/front-desk-center.ts`: directory, summary, profile overlay data, wizard, calls, events, create / save / duplicate, preflight, activate / pause / resume / archive / restore / rollback, per-agent and system checks, monitor. `front-desk-center.controller.ts` serves the `/pos/ai/front-desk/*` routes. |
| Backend, changed | `ai-lifecycles.ts` adds paused → live (resume through activation) and archived → draft (restore). `ai-agent-core.ts` narrows the plain status route. `tenant-receptionist.controller.ts`, `.list-queries.ts` and `request-schemas.ts` retire the old agent routes and bodies. `receptionist-center.ts` health runs are filtered by `scope = 'receptionist'`. `voice-booking.module.ts` wires the center. `errors.ts` gains 15 `AI_FD_*` codes. |
| POS | `POSAIFrontDeskScreen.tsx` is rebuilt in place, keeping the heading, intent line, All / Draft / Paused / Archived tabs, Create Agent and "No agents yet". Also `posAiFrontDeskApi.ts`, `ns/aifd.{en,vi}.ts` (269 keys each), `ns/errors.{en,vi}.ts`, `ns/index.ts`, `styles.css` (`.fd-*`). The old `receptionistAgents` / `createReceptionistAgent` / `setReceptionistAgentStatus` client methods are removed; provisioning stays. |
| Tests | `front-desk-center.pgtest.vitest.spec.ts` (new) and `front-desk.postgres-race.vitest.spec.ts` (new). `ai-agent.vitest.spec.ts` gains the live/archived refusals. `tenant-receptionist-audit.vitest.spec.ts`: agent audit moved to the center. `ai-calls-center.pgtest`: its fixture's two "shared" agents are `ready` (one live agent per route). `route-keys-phase9` and `idor-routes.mjs` point at the new route. `POSAIFrontDeskScreen.test.tsx` is rewritten. |
| Harness | `tooling/catalog-one-screen/fd-extra.mjs` and `interact-fd.mjs` are new. `live-server.mjs` and `interact.mjs` are wired. `rcp-extra.mjs` and `aic-extra.mjs` seeds now replace any earlier live agent on the route. Screenshots are in `results/fd-e2e/`. |
| Generated | `kysely.types.ts`, the ownership registry, the openapi manifest, attack-surface docs, owner/tech error catalogs. |

Also in this build, as a pre-task (commit `ec9309d9`): the guide 15 email webhook recorded `recordWebhook` outcomes outside `WebhookOutcome` (`not_configured`, `bad_signature`, `ok`). They are now `rejected` / `verified` / `processed`. A heuristic scan of the 125 `.ts` files changed in guides 15–22 against 161 union-typed exported functions found no other mismatch.

## 3 · Features (status vocabulary per guide §18)

| Feature | Status |
|---|---|
| Directory: server search (name, ID, description, provider ref, branch), filters (All / Draft / Paused / Archived + Setup required / Ready / Active / Degraded), sorts, date basis (created / updated / activated) with salon-local From/To month calendar and presets, 10/20/50 numbered pages (created_at DESC, id DESC), URL-persisted safe filters | COMPLETED_AND_VERIFIED |
| Summary strip from the same predicates as the filters | COMPLETED_AND_VERIFIED |
| Create Agent → persisted draft (database only, no provider), 8-step wizard (Step X of 8, Back / Save Draft / Save & Next / Close), version-checked save, reload-safe | COMPLETED_AND_VERIFIED |
| Duplicate (new id, provider binding and routing cleared, draft) | COMPLETED_AND_VERIFIED |
| A live agent is locked against edits (pause or duplicate to change it) | COMPLETED_AND_VERIFIED |
| Agent profile overlay, 8 tabs: overview, business knowledge, voice & conversation, phone & routing, booking & handoff, calls & customers (paged, this agent's calls only), subscriptions & usage, health / errors / audit | COMPLETED_AND_VERIFIED |
| **Effective state never exceeds the evidence:** "Active" only when the salon receptionist stage is `live` AND the latest recorded call on the route reached this agent's provider id. Otherwise a live agent is "Degraded". | COMPLETED_AND_VERIFIED |
| **Owner-approved activation:** preflight showing current vs proposed route, scope, customer behavior, billing statement, blockers and rollback destination; reason + confirmation; server re-check; per-route lock; prior live agent demoted and recorded; salon activated; events + audit in ONE transaction | COMPLETED_AND_VERIFIED |
| Route proof: the verified test call must have been answered by THIS agent | COMPLETED_AND_VERIFIED |
| Pause: live agent → paused, salon deactivated AND booking disarmed at once (control events + audit) | COMPLETED_AND_VERIFIED |
| Resume (a previously-live agent goes back through activation), archive (confirmation; live must pause first), restore (to draft) | COMPLETED_AND_VERIFIED |
| Rollback to the recorded prior agent (same gates); a failed activation leaves the previous route untouched | COMPLETED_AND_VERIFIED |
| Check AI Front Desk System + per-agent Check Health: read-only, recorded, rate-limited. Covers registry, one-live-per-route, provider mapping, unknown-agent calls, route drift, plus every salon gate. | COMPLETED_AND_VERIFIED |
| Live routing monitor: provider route + drift, agent health, call results, booking actions, fallback, subscription | COMPLETED_AND_VERIFIED |
| Activity history (append-only events, newest first, paged, filter by event type) | COMPLETED_AND_VERIFIED |
| Applying the route change in Twilio / Retell (number → agent) | BLOCKED_EXTERNAL. Provider-console step; this page records the approval and verifies it from the next recorded call. |
| Voice-minute 80 / 90 / 100 % warnings, verified charges | NOT_IMPLEMENTED here. Plans & Usage owns the counters; charges show "Unknown", never $0. |
| Live push of new calls (SSE/WebSocket) | NOT_IMPLEMENTED; Refresh button. |
| Physical ASUS 27″ at 100 % zoom | BLOCKED_EXTERNAL; browser viewports only. |

## 4 · Security and privacy

- **Scope and permissions:** tenant / branch / role come from the session only.
  - Reads need `ai.use`; drafts, pause, archive and restore need `ai.manage`.
  - Activate, resume of a previously-live agent, and rollback need role OWNER, enforced in the service.
- **Isolation:** another salon's agent returns 404 for read, save and every action.
- **Masking:** provider agent ids are shown as a suffix only (`…abc123`); the handoff phone is masked.
- **Transcripts:** summaries and transcripts stay in AI Calls (role-gated and audited); the calls tab links there.
- **Audit:** every change is recorded twice — an append-only event row and an `audit_events` row (module `ai_front_desk`) — in the same transaction.
- **No external calls:** nothing calls a provider, places a call or buys anything. Provisioning stays a separate, explicitly confirmed action.

## 5 · Test evidence (Oct 31 2026, stand-in runner on PostgreSQL 16, `aps` through 756)

| Suite | Result |
|---|---|
| `front-desk-center.pgtest` (UI-04, CRUD-01/02/03, SRCH-01/03, DATE-02, PAGE-01/02, ACT-01/02/03/04/05, SEC-02, TWI-03, drift, effective-state) | 16/16 |
| `front-desk.postgres-race` (real Postgres, 4 sessions): same agent ×4 → one activation; two agents on one route → exactly one live, other demoted; double-tap save → one save | 3/3. **Mutation:** per-route lock removed → 2/3, a raw `23505` surfaces. |
| Regression: receptionist-center pgtest, ai-calls-center pgtest (fixture updated), business-setup-center pgtest, ai-agent, ai-provisioning, tenant-receptionist, -audit, tenant-isolation, voice-fleet, ai-receptionist-gateway, provider-ports | 16/16, 14/14, 21/21, 9/9, 4/4, 5/5, 1/1, 6/6, 2/2, 19/19, 5/5 |
| Race regression: ai-calls, receptionist-center, business-setup-faq | 3/3 each |
| `voice-booking.controller` | 12/13. The `get_deals` failure is the same as on unchanged code (reported in guides 20–22). |
| Browser `fd` (Chromium; 5 viewports; EN/VI; Front Desk role) | 10/10, no page errors |

| Combined browser run, 23 sections (seg … rcp, fd, aic) | 237/237, no page errors |
| `comms` section | 12/12 |

**Gates (62):** 52 `check:*` pass through npm, and 6 more pass through the stand-in loader (sql-prepare, types-drift with 878 tables, sql-identifiers, db-ownership, unique-tenant-review, actor-stamp). Four can't run here and need CI: lint, boot, api-contract and strict-bodies-types. The first run flagged tenant, dialogs and response-exposure; all were fixed in code, with no baseline entries.

**IMPLEMENTED_NOT_VERIFIED (needs CI):** the POS and API type-checks, `POSAIFrontDeskScreen.test.tsx`, and `route-keys-phase9` (it needs the built `@aipowersalon/permissions` package).

## 6 · Deploy / rollback

1. Apply 756 on staging (needs owner approval).
2. Deploy the API and POS together: the old agent routes are gone and the new screen needs the new routes.
3. Rollback: revert the commit, then run the drop statements in the migration header. The data columns are additive, and the event rows stay unless dropped.

## 7 · Hand-offs

- **Reception Copilot (guide 24):** the front-desk staff assistant is separate from this agent registry. Reuse `FrontDeskCenter.route()` for "is the AI answering right now".
- **AI Calendar / AI Follow-Ups (25 / 26):** read agent state only through `effectiveState`. Never treat `status = 'live'` alone as answering.
- **AI Center (27):** summarise from `GET /pos/ai/front-desk/summary` and `/monitor`.

## 8 · Open owner decisions

1. Should a manager be able to activate (today: owner only, per the guide's "owner-approved")?
2. Should editing a live agent create a pending revision that needs re-activation, rather than being refused (today: pause or duplicate)?
3. Keep agents tenant-wide by default (branch scope empty), or require a branch per agent?
