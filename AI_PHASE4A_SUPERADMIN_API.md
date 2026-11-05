# AI Phase 4a — Super-Admin subscription management API

This is the backend that lets Super Admin create/grant/cancel the 15-package AI subscriptions from the app instead of
hand-writing SQL. Backend-first (verifiable here); the admin-web/owner UI + tenant-owner API + billing webhooks are the
remaining 4b–4d sub-phases.

## Files (new module `apps/api/src/super-admin-ai/`)
- `ai-admin-core.ts` — pure rollup + assign/update normalization
- `ai-admin.repository.ts` — port + InMemory (tested) + Kysely (raw sql, guarded)
- `ai-admin.service.ts` — operations + audit (`super_admin_ai_*` to audit_logs)
- `ai-admin.controller.ts` — `super-admin/ai` routes (SuperAdminGuard)
- `super-admin-ai.module.ts` — Kysely when DB present, in-memory otherwise
- `ai-admin.vitest.spec.ts` — 6 tests
- `app.module.ts` — module registered

## Endpoints (all SuperAdminGuard, base `super-admin/ai` — no collision with the existing `super-admin/platform/ai-packages*`)
- `GET  /super-admin/ai/packages` — the 15 packages with per-package rollup: subscribers, activeSubscribers, status
  breakdown, MRR (cents); plus platform totals.
- `GET  /super-admin/ai/packages/:code/tenants` — subscriptions for one package (with tenant name).
- `GET  /super-admin/ai/usage/summary` — usage rolled from `ai_usage_logs` by package + status.
- `POST /super-admin/ai/tenants/:tenantId/subscriptions` — assign a package / grant a trial. Body: `packageCode`
  (required), optional `status`, `trial`, `billingPeriod`, `priceCents`, `usageLimit`, `overageEnabled`, `trialDays`.
  Defaults pulled from the catalog; upserts `tenant_ai_subscriptions`.
- `PATCH /super-admin/ai/tenants/:tenantId/subscriptions/:code` — update status / usage_limit / overage / price / period.
- `DELETE /super-admin/ai/tenants/:tenantId/subscriptions/:code` — cancel (sets status `cancelled`, stamps `cancelled_at`).

## Behavior
- **Rollup** (`catalogWithRollup`): per-package subscribers, status counts, and MRR — MRR counts only `active`
  (yearly prorated to monthly); trialing/other excluded. Always returns all 15 (zeroed if none).
- **Assign/grant** (`normalizeAssign`): unknown package → 400; `trial:true` → `trialing` with `trial_ends_at` =
  now + trialDays (catalog default if omitted); otherwise `active`; price/limit default from the catalog. Idempotent
  upsert per `(tenant_id, package_code)`.
- **Update** (`normalizeUpdate`): only known fields (`status`, `usageLimit`, `overageEnabled`, `billingPeriod`,
  `priceCents`) pass; invalid status / empty patch → 400; missing subscription → 404.
- Every mutation writes an audit row (`super_admin_ai_subscription_assigned/updated/cancelled`) with tenant + actor +
  metadata, mirroring the platform module. Audit failures never break the action.

These writes are exactly what the Phase-2 gate reads, so assigning an `active` subscription here immediately makes
`POST /ai/:packageCode` work for that tenant; cancelling/expiring blocks it — closed-loop with the enforcement backbone.

## Verification
API: `tsc` clean; **523 tests** (+6: rollup/MRR math, assign defaults + trial dates, update validation, and service
assign/grant/update/cancel + not_found over the in-memory repo); `RESULT: PASS` (app boots with the module; sandbox has
no Postgres so it runs the in-memory adapter, Kysely path typecheck-verified). admin-web unchanged (94, build clean).

## Remaining (after 4a)
- **4b** — admin-web Super-Admin screen for the 15-package catalog (summary cards, per-package tenants, assign/trial/
  override/cancel modals, usage analytics) on top of these endpoints.
- **4c** — tenant-owner API + owner-web UI: `GET /tenant/ai-packages`, subscribe/cancel, usage meter, locked CTA
  (tenant-scoped by session).
- **4d** — billing/webhook sync so a payment status change flips `tenant_ai_subscriptions.status` (and thus access).
- **Phase 3** (parallel) — real provider adapters + per-assistant prompts behind the existing `AiProvider` port.
