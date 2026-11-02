# Gateway Lifecycle (Pause / Resume / Disable) — Build Report (closes REMAINING_BLOCKERS #1)

The Actions menu's "Pause / Disable…" used to just open the Configure drawer. There are now **dedicated, audited
endpoints** and three genuinely distinct states.

## Distinct states (so pause ≠ disable)
The status enum gained **`paused`** ("On Hold"), so the three actions are real transitions, not the same `disabled`:
- **Pause** → `paused` (reversible hold) — allowed from active/pending/error.
- **Disable** → `disabled` (intentionally off) — allowed from any configured state.
- **Resume** → `active` (the resolver still re-derives real usability from credentials) — allowed from paused/disabled.
A guard rejects no-ops ("already paused", "already disabled", "already active") and any action on an unconfigured gateway.

## What was added
- **DB migration `097_gateway_paused_status.sql`** — widen `tenant_payment_config.status` CHECK to include `paused`
  (idempotent re-statement). A paused gateway is non-active, so checkout already treats it as not usable.
- **`payments/payment-gateway.resolver.ts`** — `paused` added to the `GatewayStatus` union (non-active handling is generic,
  so no other resolver change).
- **`super-admin-platform/payment-gateways-core.ts`** — `paused` in the status union/mapping; label **"On Hold"**; included
  in the status breakdown; new **pure, unit-tested** guard `gatewayStatusTransition(current, action) → { ok, to, error }`.
- **`super-admin-tenants.controller.ts`** — three routes:
  `POST /super-admin/tenants/:id/payment-gateway/{pause,resume,disable}`. Each reads the current masked status, runs the
  pure guard, applies the target via the **existing** `resolver.upsertConfig({ status })`, writes an **audit** event, and
  returns the masked gateway. `400` on an illegal transition.
- **`super-admin-tenants.service.ts`** — thin `recordGatewayStatusAudit(...)` writing `super_admin_gateway_{paused,resumed,
  disabled}` to `audit_logs` (no secrets; masked from/to). New audit actions added to the `TenantAuditAction` union.
- **Frontend** — `superAdminApi.{pauseGateway,resumeGateway,disableGateway}`; the row **Actions menu** now shows contextual
  **Pause Gateway** (active/pending/error), **Resume Gateway** (paused/disabled), and **Disable Gateway** (red, any
  configured non-disabled) — each calling the audited endpoint and reloading; the **detail panel** gained a contextual
  Pause/Resume button; the **On Hold** badge + an **On Hold** Status filter option were added.

## Tests / verification
- `payment-gateways-core.spec.ts` — **77 assertions** (was 65): `paused` mapping + the full transition matrix
  (pause/resume/disable happy paths, every no-op rejection, and unconfigured rejection).
- `PaymentGatewaysScreen.test.tsx` — **11 tests** (was 9): "Pause Gateway action calls the audited pause endpoint" and
  "a paused gateway shows On Hold and offers Resume".
- Full backend suite **606 + harness, RESULT: PASS**; full admin-web **30 files / 158 tests**; `tsc` clean (api +
  admin-web); production `vite build` succeeds.

## Honest notes
- Resume sets status to `active`; if credentials are incomplete the resolver still reports the gateway as not usable
  (`error`) — honest, not silently "on".
- These endpoints reuse the existing per-tenant isolation (`SuperAdminGuard` + explicit `:id`) and the resolver's
  encryption/masking; no secret is read or written by the lifecycle actions.
