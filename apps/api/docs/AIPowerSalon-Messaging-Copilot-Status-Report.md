# AIPowerSalon — Messaging & Reception Copilot: Status & Verification Report

_Snapshot date: 2026-07-05. This is a consolidated, honest picture of the AI Reception Copilot + multi-tenant Twilio
messaging work: what exists, what's verified, and exactly what remains on the owner side. The running slice-by-slice
log lives in `AI_RECEPTION_COPILOT.md`; the deployment guide lives in `AIPowerSalon-Twilio-Scale-Runbook.md`
(also `apps/api/docs/`)._

---

## 1. Verified state (last run this session)

| Workspace | Tests | Files | tsc | build | lint |
|---|---|---|---|---|---|
| apps/api | **2903 passed** | 450 | 0 | clean | clean |
| apps/pos-web | **321 passed** | 70 | 0 | clean | clean |
| apps/admin-web | **726 passed** | 121 | 0 | clean | clean |

Migrations **301–311** apply cleanly in sequence on Postgres 16. Design invariants held throughout: money in integer
cents; Fiserv/Clover only; tenant/branch identity server-derived from `req.ctx`; honest verification (no fabricated
values — unconfigured states render as not_configured / degraded / mock); reuse over duplication; no test deletion.

New migrations in this body of work:
- **307** `reception_copilot_action_ledger` — idempotency for Copilot write actions.
- **308** `idx_audit_events_module_occurred` — module-leading index for the cross-tenant usage rollup.
- **309** `tenant_messaging_numbers` — number → tenant registry (inbound routing + per-tenant send).
- **310** notifications `delivered` status + `delivered_at` + provider_id index — delivery receipts.
- **311** `tenant_messaging_credentials` — per-tenant Twilio account, auth token AES-256-GCM encrypted.

---

## 2. What was built (26 slices)

### AI Reception Copilot (staff-facing, `apps/pos-web` → `/tenant/ai/copilot`)
Read surfaces: caller context, queue summary, duplicate candidates, availability, technician recommendations, conflict
detection, message drafting, intent detection. Write spine: cancel / reschedule / create appointment / send message —
every write is confirm-gated, settings-gated, idempotent (migration 307), and audited under module `reception_copilot`.
Super Admin usage rollup (`admin-web` → Reception Copilot) with a module-leading index. Branch-level settings hierarchy
(tenant-wide defaults ← branch overrides) reusing the generic `tenant_settings` store, with a 30s TTL cache on the
per-action read.

Endpoints (`/tenant/ai/center`): `copilot/context`, `copilot/queue`, `copilot/duplicates`, `copilot/availability`,
`copilot/technicians`, `copilot/conflict`, `copilot/draft-message`, `copilot/intent`, `copilot/action`,
`copilot/settings` + `/super-admin/copilot/usage`.

### Scale hardening (10k+ tenants, in code)
Server-derived scoping everywhere; the cross-tenant usage query is indexed (308) and bounded to a default 30-day
window; idempotency ledger and settings rows have unique indexes; the hot settings read is cached. Ops-level items
(Redis, pooling, read replicas, per-tenant quotas, audit partitioning) are documented, not faked — see runbook §8.

### Twilio messaging loop (both directions, multi-tenant)
- **Send + draft**: through the existing `NotificationsService` → `TwilioSmsSender` (credit-metered, opt-out-checked,
  logged). Deterministic draft templates enriched with the customer's real appointment.
- **Inbound opt-out**: signature-verified `POST /webhooks/twilio/sms/inbound` → resolves tenant by `To` → records
  STOP/START through existing opt-out state.
- **Delivery receipts**: signature-verified `POST /webhooks/twilio/sms/status` → flips the log sent → delivered/failed
  with `delivered_at` (sender attaches `StatusCallback` only when `TWILIO_STATUS_CALLBACK_URL` is set).
- **Per-tenant number**: send resolves the tenant's registered number as `from`, else the shared default.
- **Per-tenant credentials**: each salon's own Twilio account (Account SID + encrypted Auth Token + From) configured in
  Super Admin AND self-service; send prefers the tenant's own account; **webhook signatures verified with the tenant's
  own token** (resolved by the callback's `AccountSid`), else the shared token.
- **"Send test SMS"**: real diagnostic through the tenant's own account, honest success (sid) / failure (provider
  error) / not_configured.

### Frontend wiring (both apps)
- **admin-web** sidebar → **AI & Automation → Tenant Messaging (Twilio)** (tenant selector), plus a per-tenant
  **Twilio Setup** action in the tenant directory, plus the deep-link route.
- **pos-web** sidebar → **COMMUNICATIONS → Text Messaging Setup** (self-service, `settings.edit`-gated).
- Auth tokens are write-only everywhere (masked `••••last4`, never returned).

### LLM readiness
Message drafting runs deterministically today and upgrades to LLM-polished automatically once an AI provider key is set
(routed through the existing `AiAssistantService`; a mock response is detected and ignored). Intent detection stays
deterministic by design.

---

## 3. What remains — all owner/account/infra (nothing code-blocked)

1. **Twilio account + A2P/ISV registration** (runbook §2): Primary Customer Profile (ISV) → per-salon Secondary
   Profile / Brand / Campaign → Messaging Service → numbers. Campaign reviews ~10–15 days; automate via the A2P APIs at
   scale.
2. **Environment**: `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM` (shared default), plus
   `TWILIO_STATUS_CALLBACK_URL`, plus `PROVIDER_VAULT_KEK` (≥32 chars) so per-tenant tokens encrypt under a real key.
   Point each number's inbound + status webhooks at `/webhooks/twilio/sms/inbound` and `/webhooks/twilio/sms/status`.
3. **Per-tenant numbers**: buy a number per salon and register it (Super Admin → Twilio Setup, or self-service). Send,
   inbound routing, and receipts then key off it automatically.
4. **AI provider key** (`OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY`) + the `ai_reception_copilot` package
   on the tenant → drafts become LLM-polished.
5. **Deployment infra** (runbook §8): Redis for cross-instance cache, connection pooling, read replicas, per-tenant
   rate quotas, `audit_events` partitioning.

### Recommended first validation
In staging: set `PROVIDER_VAULT_KEK` and one salon's real Twilio credentials, then use **Send test SMS**. Next, send an
appointment text, reply **STOP** from the receiving phone, and confirm the opt-out is recorded and a delivery receipt
lands. That exercises the entire loop against reality and will surface anything environment-specific.

---

## 4. Honesty boundaries
Everything above is real, wired, and tested in the monorepo. The items in §3 are account, environment, and
infrastructure decisions that cannot be built or validated from inside the repository, so they are documented rather
than stubbed or faked. Where a provider isn't connected, the system reports an honest state (not_configured / degraded /
mock) instead of pretending success.
