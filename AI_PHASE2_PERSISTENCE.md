# AI Phase 2 — real persistence + live gate enforcement

Phase 1 built the access-gate backbone with an in-memory default-deny repo. Phase 2 makes it read **real paid
subscriptions and real usage** from the database, so "no pay, no AI" is enforced against actual data — not a stub.

## Files
- `apps/api/db/migrations/090_tenant_ai_subscriptions.sql` (new) — per-package paid subscription
- `apps/api/db/migrations/091_ai_usage_logs.sql` (new) — per-call usage + status
- `apps/api/src/ai/ai-access.kysely.repository.ts` (new) — Kysely access repo + usage logger + pure `assembleSnapshot`
- `apps/api/src/ai/ai.module.ts` — Kysely repos when a DB handle exists, in-memory otherwise
- `apps/api/src/ai/ai-access-kysely.vitest.spec.ts` (new) — 4 tests for the mapping

## Schema
- **`tenant_ai_subscriptions`**: one row per `(tenant_id, package_code)`; `status` covers the full spec set
  (active/trialing/past_due/unpaid/cancelled/expired/disabled/suspended); trial + current-period timestamps; payment
  provider/subscription/customer refs; `usage_limit` (0 = unlimited) and `overage_enabled`. Super Admin grants
  trials / overrides limits by writing here. FK to `tenants`, `UNIQUE(tenant_id, package_code)`.
- **`ai_usage_logs`**: append-only row per call with tokens, `usage_unit`/`usage_amount`, `cost_estimate_cents`, and
  `status` (success / blocked_unpaid / blocked_limit / blocked_permission / provider_error). Indexed for per-period sums.

## The live access repo
`KyselyAiAccessRepo.loadSnapshot(tenant, package, user)` assembles the gate's snapshot from real data:
- tenant account status ← `tenants.status`
- the paid subscription (status, trial end, period start, usage_limit, overage) ← `tenant_ai_subscriptions`
- **current-period usage** ← `SUM(ai_usage_logs.usage_amount)` for that package since `current_period_starts_at`, status
  = success
- permission ← the user's role from `users` checked against RBAC `can(role, 'ai.use')`

**Fails closed.** Every query is `.catch`-guarded; any DB hiccup yields a default-deny snapshot (no subscription → gate
returns `not_subscribed`), never accidental open access. Unknown tenant maps to `suspended` (denied). The raw→snapshot
mapping is extracted into a pure `assembleSnapshot` and unit-tested directly (default-deny, active+limit, trial carry,
tenant/role mapping), then fed through the real gate to confirm the decision — so the DB path is verified without a live
Postgres.

`KyselyAiUsageLogger.log` inserts every usage row (success, blocked, provider_error) so usage totals and analytics are
real. The module swaps in-memory → Kysely purely by DI token, so nothing else changed.

## What this enables now
A tenant with an `active` (or unexpired `trialing`) row in `tenant_ai_subscriptions` and a role that has `ai.use` can use
that package up to its `usage_limit` (or beyond if `overage_enabled`); everyone else is denied with the precise reason.
Usage accrues per period from `ai_usage_logs`, which also feeds the limit check. The 15 codes from the catalog are the
valid `package_code` values.

## Verification
API: `tsc` clean; **517 tests** (+4); `RESULT: PASS` (app boots with the Kysely-wired AI module; in the sandbox there is
no Postgres so it runs the in-memory adapters, and the Kysely path is typecheck-verified). admin-web unchanged (94,
build clean). Migrations 090/091 sequenced after 089.

## Still ahead (unchanged from the Phase 1 plan)
- **Phase 3** — real OpenAI/Anthropic/Gemini adapters behind the existing `AiProvider` port + per-assistant prompt
  templates (env keys, never sent to the frontend).
- **Phase 4** — Super-Admin 15-package admin (assign/trial/override/usage analytics) + tenant-owner purchase/usage APIs
  & UI + billing/webhook sync so a payment status change flips access.
- **Phase 5** — POS entry points per assistant rendering the gate's locked/upgrade panel when denied.

To create a subscription for testing once on a real DB: insert a `tenant_ai_subscriptions` row with
`status='active', package_code='ai_business_assistant', usage_limit=1000` for a tenant, then `POST /ai/ai_business_assistant`
as a user of that tenant.
