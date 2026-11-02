# AI Package System — deep scan + Phase 1 (enforcement backbone)

You asked me to scan first and not duplicate. I did. The headline: an AI **catalog/admin** layer exists, but the
**runtime** (the 15 assistants, the access gate, the gateway, tenant/POS wiring) did not. I built the verifiable
enforcement backbone every assistant will reuse, and I'm being explicit about what remains, because building all 15
assistants + tenant UI + POS wiring + billing webhooks responsibly is a multi-phase effort and real provider calls /
Postgres can't run in this sandbox.

## 1. Deep-scan summary

**Already existed (Super-Admin catalog + tenant tier flags):**
- Tables: `tenant_ai_packages` (one AI *tier* per tenant), `tenant_ai_features` (7 boolean override toggles, not 15),
  `tenant_usage_limits`. (migration 061)
- Super-Admin endpoints under `super-admin/platform`: `GET/POST ai-packages`, `POST ai-packages/:tenantId/features`,
  `GET/POST usage-limits`.
- Super-Admin screens: `AIPackagesScreen.tsx`, `UsageLimitsScreen.tsx`.
- RBAC: `ai.use`, `ai.manage`, `super_admin.ai_packages.manage`.

**Did NOT exist (the entire runtime):**
- No 15-package catalog (only 7 feature keys). No per-package paid subscription with status
  (active/trialing/past_due/unpaid/cancelled/expired/disabled/suspended). No `ai_usage_logs`. No access-gate service.
  No AI gateway/provider abstraction. **None of the 15 `/ai/*` endpoints.** No tenant-owner purchase/usage UI. No POS
  AI widgets / locked-upgrade states.

**Demo/fake vs real:** the Super-Admin AI screens are real (wired to the platform service), but they manage a coarse
tier + 7 toggles — they are not the 15-package paid system. Nothing AI actually *runs* anywhere yet.

**Duplicates:** none created. The new backbone lives in a fresh `apps/api/src/ai/` module and reuses the existing
catalog/RBAC rather than re-implementing Super-Admin controls.

## 2. What I built this turn (Phase 1 — backbone, fully tested)

All in `apps/api/src/ai/`:
- **`ai-catalog.ts`** — the canonical **15 AI packages** (codes from your spec §5: `ai_booking_assistant` …
  `ai_analytics_forecasting`), each with name, category, POS area, monthly price (cents), included usage limit, usage
  unit, overage price, trial days. Single source of truth so every layer agrees on the 15 codes.
- **`ai-access-gate.ts`** — the **enforcement heart**: a pure `evaluateAiAccess(snapshot)` implementing the §3/§4
  "must pay before access" rule across **all 8 statuses** + tenant-status block (suspended/cancelled unless support
  mode) + package-enabled + permission + usage-limit/overage + trial expiry + a Super-Admin `past_due` policy
  (block vs limit). Returns `{ allowed, reason, subscriptionStatus, remainingUsage, upgradeRequired, limitExceeded }`
  plus a human label for the POS locked screen.
- **`ai-gateway.ts`** — shared provider abstraction (`AiProvider` port + deterministic `MockAiProvider` + env factory),
  so no endpoint calls a provider directly; plus the **usage-logger** port + statuses
  (success/blocked_unpaid/blocked_limit/blocked_permission/provider_error) and an in-memory logger.
- **`ai-assistant.service.ts`** — the shared orchestration every one of the 15 endpoints uses: **load snapshot → gate →
  (deny: log blocked + return decision, no provider call, no charge) / (allow: run gateway → log usage → safe
  response)**. Ships a **default-deny** in-memory access repo (closed unless a paid subscription is proven).
- **`ai-assistant.controller.ts`** — one tenant-facing route `POST /ai/:packageCode` serving all 15 codes; 403 with a
  clean reason+label when the gate denies, 404 unknown package, 401 unauthenticated, 502 on provider error.
- **`ai.module.ts`** — wires it; **boots safely offline**: with no seeded subscription and no provider key, every AI
  call returns 403 `not_subscribed` rather than running AI.

**Tests (13):** catalog integrity (exactly 15, unique codes, priced); the gate across every status + trial + tenant
suspend + support mode + limit + overage + unlimited; and the orchestration (default-deny, allow+success log, unknown
package 404, provider-error 502 + logged). API: `tsc` clean, **513 tests**, `RESULT: PASS`. admin-web unchanged (94,
build clean).

## 3. The phased plan for the rest (not built this turn)

- **Phase 2 — persistence + real gate data.** Migrations for `tenant_ai_subscriptions` (per-package status, trial/period
  dates, payment refs, usage_limit, overage) and `ai_usage_logs`; a **Kysely `AiAccessRepo`** that assembles the
  snapshot from those + `tenants.status` + RBAC; a Kysely usage logger. Swap the in-memory providers in `ai.module.ts`
  for the Kysely ones (factory already injects by token).
- **Phase 3 — provider adapters.** OpenAI/Anthropic/Gemini adapters behind the existing `AiProvider` port + per-assistant
  prompt templates (one per `packageCode`), selected by `AI_DEFAULT_PROVIDER`. Keys stay server-side.
- **Phase 4 — Super-Admin + tenant APIs/UI.** Extend the existing AI-packages admin module to the 15-package catalog
  (summary cards, per-package tenants, assign/trial/override, usage analytics); tenant-owner `GET /tenant/ai-packages`,
  subscribe/cancel, usage meter; billing/webhook sync so payment status flips access.
- **Phase 5 — POS wiring.** Per-assistant entry points in pos-web/owner-web at the POS areas in your §11, each calling
  `POST /ai/:packageCode` and rendering the locked/upgrade panel from the gate's reason+label when denied.

## 4. How to test the paid-access rule now
`cd apps/api && npx vitest run src/ai` exercises the whole gate + orchestration. The key guarantee already holds in code:
**the controller cannot reach the provider without passing the gate**, and the default repo denies until a paid
subscription is seeded — so "no pay, no AI" is enforced at the backend, not just the UI.

## 5. Env vars (Phase 3, centralized; never sent to frontend)
`AI_DEFAULT_PROVIDER`, `AI_DEFAULT_MODEL`, `AI_MAX_TOKENS`, `AI_TIMEOUT_MS`, `AI_COST_TRACKING_ENABLED`,
and provider keys `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY`. Until any key is set, the Mock provider runs
so the wiring is exercised without external calls.
