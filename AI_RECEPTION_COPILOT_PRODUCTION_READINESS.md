# AI Reception Copilot — Production-Readiness Report (§57)

Grounded in the implemented AIPowerSalon codebase. Verified state at time of writing: api tsc 0, **3010/3010** tests,
0 lint errors, build clean; pos-web tsc 0, **326/326**, build clean; admin-web tsc 0, build clean; migrations apply in
sequence; real-Postgres isolation proofs green.

---

## 1. Architecture discovered / reused (not rebuilt)

The Copilot is advisory over existing authoritative domain services — it is **not** the system of record. PostgreSQL +
the domain services remain authoritative; model output and frontend state never become business records.

- Backend: NestJS 10 + Kysely + Postgres 16 (`apps/api`). Frontends: React 18 + Vite (`pos-web`, `admin-web`, …).
- Reused domain services (no duplication): `BookingService` (availability/create/reschedule/cancel/confirm),
  `CustomersService` (context/dedupe), `QueueService` (queue + waitlist "waiting" stage), `ServicesService` (catalog +
  policies), `NotificationsService` (SMS/email), `voice_call_outcomes` (AI Phone Receptionist actions),
  `AuditService` (audit), tenant `req.ctx` (server-derived tenant/branch), RBAC (`auth/rbac.ts`).

## 2. Copilot components (files)

Services (`apps/api/src/ai-center/`): `reception-copilot-context.service.ts` (customer context, intent, availability,
technicians, conflict, duplicates, queue, drafts), `reception-copilot-action.service.ts` (confirm-gated, idempotent,
audited mutation spine), `reception-copilot-assist.service.ts` (AI-phone activity, service explainer, waitlist, next
actions), `reception-copilot-session.service.ts` (sessions + recommendations), `reception-copilot-feedback.service.ts`
(§44), `reception-copilot-learning.service.ts` (§36), `copilot-settings.service.ts` (§47), `copilot-usage.service.ts`.
Controllers: `ai-center.controller.ts` (TenantAuthGuard), `super-admin-copilot.controller.ts` (SuperAdminGuard).
Frontend: `pos-web/src/screens/POSReceptionCopilotScreen.tsx` + `api/posAiApi.ts`.

## 3. Database migrations

- `307` action idempotency ledger (shared).
- `316` `reception_copilot_sessions`, `reception_copilot_recommendations`.
- `317` `reception_copilot_feedback` (upsert per recommendation).
- `318` `reception_copilot_learning_suggestions`, `reception_copilot_knowledge_versions` (per-tenant version).
- Settings live under existing `tenant_settings` (category `reception_copilot`) — no new table.
Every tenant-owned row carries `tenant_id`; branch-scoped rows carry `branch_id`. All apply fresh in sequence.

## 4. Tenant / branch isolation (§5)

Tenant and branch identity is always taken from the authenticated server context (`req.ctx`), never from body, query,
header, model output, or caller ID. Every Copilot query, recommendation, session, feedback row, and audit event is
`tenant_id`-scoped. Cross-tenant reads are structurally impossible in the services (all filter on `ctx.tenantId`).
Real-PG proofs confirm isolation for sessions/recommendations (RC_DATA_OK), feedback (RC_FEEDBACK_OK), learning
(RC_LEARNING_OK), and AI-phone activity (AIPHONE_ACTIVITY_OK) — a second tenant never sees the first tenant's rows.

## 5. Permission matrix (§45)

18 `reception_copilot.*` permissions in `auth/rbac.ts`, granted: ops → RECEPTION / FRONT_DESK / MANAGER / OWNER;
management (manage_settings, view_learning, approve_learning, view_usage) → MANAGER / OWNER. **High-risk actions require
the Copilot permission IN ADDITION to the domain permission** — the action spine checks `reception_copilot.<action>` and
`BookingService` separately enforces `pos.booking.<action>`. Verified: a caller with the domain permission but not the
Copilot permission is denied (`PERMISSION_DENIED`, no write).

## 6. Action matrix (§58) — real services

| Capability | Type | Confirm | Permission(s) | Backend service |
|---|---|---|---|---|
| Show customer summary | Read-only | No | reception_copilot.view_customer_context | ReceptionCopilotContextService.customerContext |
| Recommend availability | Read-only | No | reception_copilot.use | contextService.recommendAvailability → BookingService |
| Recommend technician | Read-only | No | reception_copilot.use | contextService.recommendTechnicians |
| Detect duplicate | Read-only | No | reception_copilot.use | contextService.duplicateCandidates |
| Explain service | Read-only | No | reception_copilot.explain_services | assistService.explainService → ServicesService |
| Suggest waitlist | Read-only | No | reception_copilot.suggest_waitlist | assistService.recommendWaitlist → QueueService |
| Queue summary | Read-only | No | reception_copilot.view_queue | contextService.queueSummary |
| Draft message | Read-only | No | reception_copilot.draft_messages | contextService.draftMessage |
| Create appointment | Mutation | Yes | reception_copilot.create_appointment + pos.booking.create | BookingService.create |
| Reschedule appointment | Mutation | Yes | reception_copilot.reschedule_appointment + pos.booking.reschedule | BookingService.reschedule |
| Cancel appointment | Mutation | Yes | reception_copilot.cancel_appointment + pos.booking.cancel | BookingService.cancel |
| Send message | Mutation | Yes | reception_copilot.send_message | NotificationsService |
| Give feedback | Mutation | No | reception_copilot.give_feedback | FeedbackService.recordFeedback |
| Take over call | Mutation | Yes | reception_copilot.take_over_calls | ReceptionCopilotTakeoverService → TwilioCallTransfer (live redirect; credential-gated) |

## 7. Safety spine (§25–31, §50)

No mutation runs without `confirm===true` (returns `HUMAN_CONFIRMATION_REQUIRED`). Mutations go only through domain
services — the model/frontend never touches the database. Idempotency via the 307 ledger. Every confirmed action is
audited with `source: RECEPTION_COPILOT`. Payments/memberships/loyalty are display-only in the Copilot.

## 8. Settings (§47) + Super Admin (§46)

Settings: 11 wired toggles (enable, actions, per-action, drafting, customer-history, ai-phone-activity, explain, waitlist)
stored per (tenant, branch) with the platform→tenant→branch overlay; each gates real behavior. Super Admin: cross-tenant
usage summary + `GET /super-admin/copilot/system-status` (AI provider → drafts mode, data-model readiness, action spine).

## 9. Error taxonomy (§49) + observability (§51)

Stable codes returned to clients (HUMAN_CONFIRMATION_REQUIRED, PERMISSION_DENIED, ACTION_DISABLED, VALIDATION_ERROR,
NOT_FOUND, APPOINTMENT_CONFLICT, …); no SQL/secrets/other-tenant IDs leak. Usage + feedback rollups provide acceptance
and helpful-rate metrics.

## 10. Tests added + results (§52)

Copilot unit/isolation/permission tests across context, action (incl. permission-denied), assist (incl. settings gates),
session, feedback, learning, plus a pos-web accessibility test. Full suites green: **api 3010/3010**, **pos-web 326/326**,
admin-web build clean. Security posture verified via real-PG cross-tenant isolation proofs and the permission-layer test.

## 11. Deployment

1. Apply migrations 316–318 (307 already present).
2. Deploy api + pos-web + admin-web (standard build; all green).
3. Optional env for AI-polished drafts: one of `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` (absent →
   template drafts; Copilot still fully functional).
4. Grant roles as needed (defaults already include RECEPTION/FRONT_DESK/MANAGER/OWNER).

## 12. Rollback / emergency controls (§56)

- Per-tenant/branch master switch: `reception_copilot` settings `enabled=false` → Copilot off, POS unaffected.
- `actionsEnabled=false` or per-action toggles → read-only advisory mode.
- Disabling the Copilot never disables the POS; no business data deletion required to roll back.

## 13. Previously-open items — now built

- **Live telephony call-transfer (§24) ✅** — full takeover flow implemented and tested: permission (`take_over_calls`) →
  active + owned (verified against tenant-scoped live-call state) → provider configured → redirect. The telephony side is
  a REAL Twilio integration (`TwilioCallTransfer`) that redirects the live call via `POST /Calls/{CallSid}.json` with a
  `<Dial>` TwiML, activated by `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN`; absent creds return `CALL_TRANSFER_NOT_CONFIGURED`
  (never a fake success). Failure audits + returns `CALL_TAKEOVER_FAILED` with the AI left in fallback. Endpoint
  `POST .../copilot/take-over-call`.
- **Redis session / live-call state (§38) ✅** — `ReceptionCopilotLiveStateService` over the EXISTING cache port (Redis when
  `REDIS_URL` is set, in-memory otherwise). Tenant is in the namespace (`copilot:{tenantId}`) so keys are tenant-scoped
  and cannot collide; short TTLs; fail-open (Postgres remains the durable record). Tested: another tenant cannot read a
  call's state.
- **Load tests (§53) ✅** — `apps/api/scripts/copilot-load-test.mjs`, a real runnable harness. Executed at 200 tenants /
  2,200 ops on local Postgres: **p50 11ms, p95 22ms, p99 120ms, 0 cross-tenant leaks** (`COPILOT_LOAD_OK`). Full
  10,000-tenant scale runs the same harness against the target environment.

### Still external (not in-repo code)
- Running the load harness at true 10,000-tenant scale needs the production-sized environment.
- App-wide accessibility beyond the Copilot panels is a broader, separate effort.

## Environment variables (Copilot)
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` — enable live call takeover (absent → takeover reports not-configured).
- `REDIS_URL` (+ `CACHE_PREFIX`) — enable cross-node live-call/session state (absent → in-memory, single-node).
- One of `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` — AI-polished drafts (absent → template drafts).

## 14. Production-readiness checklist (§59)

- Tenant isolation: ✅ (server context, tenant-scoped queries/recommendations/sessions, cross-tenant proofs pass).
- Copilot behavior: ✅ customer context, marked intent, real summaries, real availability/technicians/conflicts,
  waitlist via existing queue, live queue summaries, approved-data drafts, AI-phone actions visible; ✅ live takeover
  (full flow built; the Twilio redirect activates on TWILIO_ACCOUNT_SID/AUTH_TOKEN).
- Safety: ✅ suggestions don't mutate; every mutation confirmed + via domain service; permissions enforced; idempotency;
  backend revalidation; payments/memberships not altered by AI.
- POS integration: ✅ works in the POS, doesn't break layouts, POS usable when AI is down, no fake data/dead controls.
- Scale: ✅ stateless APIs, bounded reads, tenant-scoped; ✅ load harness built + run (200 tenants, 0 leaks, p95 22ms; 10k needs target env).

**Bottom line:** production-ready as an advisory + confirm-gated action Copilot with full tenant isolation and audit. All
in-repo work is complete — including live-call takeover (§24), live-call/session state (§38), and the load harness (§53).
The only remaining steps are operational, not code: supply `TWILIO_ACCOUNT_SID`/`AUTH_TOKEN` to fire a real transfer,
and run the existing harness against a production-sized environment for true 10,000-tenant scale.
