# AI Phase 4c (backend) — tenant-owner AI API

The tenant-facing surface for the 15 AI packages, fully tenant-scoped from the session. An owner can see each package
with their own subscription + live access state, start a trial, cancel, and view usage. The owner-web screen sits on top
of this and is the next sub-step (4c-frontend).

## Files (new module `apps/api/src/tenant-ai/`)
- `tenant-ai.repository.ts` — tenant-scoped port + InMemory (tested) + Kysely (raw sql, guarded)
- `tenant-ai.service.ts` — catalog-with-access, self-serve trial, cancel, usage
- `tenant-ai.controller.ts` — `/tenant/ai` routes (session ctx like the owner controller)
- `tenant-ai.module.ts` — Kysely when DB present, in-memory otherwise
- `tenant-ai.vitest.spec.ts` — 6 tests
- `app.module.ts` — registered

## Endpoints (session-scoped; tenant_id comes from `req.ctx`, never the body)
- `GET  /tenant/ai/packages` — all 15 with this tenant's `subscription` (status, limit, overage, trial end), `used`,
  `remainingUsage`, and **live `accessible` + `lockReason`/`lockLabel`** computed by the SAME gate the backend enforces,
  plus `trialAvailable`.
- `GET  /tenant/ai/subscriptions` — this tenant's subscriptions.
- `GET  /tenant/ai/usage` — per-package usage totals for this tenant.
- `POST /tenant/ai/subscriptions` `{ packageCode }` — **start a trial** (self-serve).
- `PATCH /tenant/ai/subscriptions/:code/cancel` — cancel.

## Honest scope + safety
- **Self-serve can only START A TRIAL.** Paid activation goes through billing (Phase 4d) or Super Admin (4a) — the tenant
  endpoint never self-grants paid (`active`) access, preserving "must pay before access." Trial requires the package to
  offer trial days and no existing live subscription (else `already_subscribed`).
- **Tenant isolation:** every repo method is filtered by the caller's own `tenant_id`; the body cannot widen scope. The
  controller derives ctx from the session exactly like `owner.controller`.
- **Permissions:** viewing needs `ai.use`/`ai.manage`; subscribe/cancel require `ai.manage` or `subscription.manage`
  (OWNER has these). Missing tenant or permission → 403.
- **Reuse, no duplication:** the per-package access state reuses the Phase-1 `evaluateAiAccess` gate and the catalog;
  trial creation reuses `normalizeAssign` from the Super-Admin core. The 15 codes are the single catalog.

The lock reasons returned here (`not_subscribed`, `trial_expired`, `past_due`, `limit_exceeded`, …) are exactly what the
owner-web locked/upgrade panel will render, and they match what `POST /ai/:packageCode` enforces — one source of truth.

## Verification
API: `tsc` clean; **529 tests** (+6: catalog access states incl. expired trial, start-trial, double-subscribe/unknown
rejected, cancel + not_found, tenant/permission guards); `RESULT: PASS` (boots with the module; sandbox runs the
in-memory adapter, Kysely path typecheck-verified). admin-web unchanged (build clean).

## Remaining
- **4c-frontend** — owner-web "AI Packages" screen (catalog cards with usage meter + locked/upgrade CTA, start-trial,
  cancel), opened from the owner app's More tab. (owner-web uses a tab/pushed-screen shell, not router.)
- **4d** — billing/webhook sync so a payment status change flips `tenant_ai_subscriptions.status` (and thus access).
- **Phase 3** — real provider adapters + per-assistant prompts behind the existing `AiProvider` port.
- **Phase 5** — POS entry points per assistant rendering the gate's locked/upgrade panel.
