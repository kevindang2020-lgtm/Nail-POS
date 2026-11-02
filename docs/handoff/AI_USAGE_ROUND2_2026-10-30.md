# AI Usage & Limits — Round 2 (Four-Module Completion Guide, Oct 30 2026): AI-01 + AI-02

Source: *AI PowerSalon Four-Module Completion & Verification Blueprint* §11 (invoice-backed charges, tax, proration),
§12 (per-branch AI operational configuration), §15–§19 (evidence standard). Extends the round-1 build
(`docs/handoff/AI_USAGE_LIMITS_2026-10-30.md`, commit 9c02b2ab) — same route `/tenant/ai/usage`, same screen, same
repository and controller. **Local commit only — not pushed, not deployed, migration 728 not run in staging or
production, no billing provider called, nothing charged, no live billing modified.**

## 1. Status matrix

| ID | Deliverable | Status | Evidence (run here) | Still needed |
|---|---|---|---|---|
| AI-01 | Invoice / tax / proration reconciliation | **Verified** (fixtures, local Postgres + harness) · **Blocked - External Setup** for a real provider | `ai-invoices-branches.pgtest` 9 AI-01 tests; harness steps r2-1, r2-2 | Owner connects a billing provider client (read-only `listInvoices`) and the webhook secret; staging run against the provider's test mode |
| AI-02 | Per-branch operational AI settings | **Verified** (local Postgres + harness) | `ai-invoices-branches.pgtest` 5 AI-02 tests; harness step r2-3 | Gateway callers that do not pass a branch yet stay salon-wide (see §6) |

The guide's three AI must-pass scenarios (§17):

| Scenario | Status | Test |
|---|---|---|
| Recurring price distinct from finalized invoice, tax, net proration, paid and due; no charges for reporting | Verified | pgtest "guide acceptance …", "reconciliation re-reads … never charges"; harness r2-1/r2-2 |
| Same tenant subscription while per-branch settings differ; shared quota not duplicated | Verified | pgtest "Branch A on, Branch B off …"; harness r2-3 |
| Global disable overrides branch enable; expired entitlement cannot be bypassed | Verified | pgtest "a global disable beats a branch enable", "an expired entitlement cannot be bypassed" |

## 2. Audit — what existed

| Record | What it holds | Gap for §11 / §12 |
|---|---|---|
| `tenant_ai_subscriptions` (090) | one row per tenant × package: status, price, period, limit | entitlement only — no money, no branch |
| `ai_billing_events` (092) | deduplicated provider events that move the status machine | **no amounts**, no invoice id |
| `billing_invoices` / `billing_invoice_lines` / `billing_webhook_events` (195/198) | platform SOFTWARE-plan invoices written by the Super Admin billing cycle | keyed by `plan_code`, no provider invoice id, no AI package, no proration lines — not reused for AI to avoid double counting the platform plan |
| CardPointe bridge (`ai-cardpointe-billing.ts`) | maps a charge/refund response to a status event | status only |
| `ai_usage_logs` (091) | one row per AI call | no branch |
| access gate (`evaluateAiAccess`) | global switch → tenant entitlement → permission → quota | no branch dimension |

So nothing linked an AI package subscription to a provider invoice, tax, proration, payment or refund, and there was no
branch override. Added only that (migration 728, below).

## 3. What was built

### AI-01 — invoice-backed charges (`modules/ai/src/ai/ai-billing-invoices.ts`)
* **Ledger** `AiInvoiceLedger.ingest(event)`: one provider invoice snapshot per call, in one transaction with an advisory
  lock per invoice. Dedupe: `ai_billing_invoice_events` UNIQUE (provider, provider_event_id), append-only (trigger) — a
  re-delivered webhook is `duplicate` and changes nothing. Ordering: an OLDER snapshot (`provider_updated_at`) is `stale`
  and never overwrites; an identical snapshot (sha-256 of the normalized invoice) is `unchanged` (payment retries). Invalid
  snapshots (unknown status, non-integer money, duplicate line ids, unknown tenant) are `rejected` and logged, never
  half-recorded.
* **Figures** (`invoiceFigures`): the provider's subtotal / tax / total win; lines fill a gap only when the provider omitted
  it; a disagreement is flagged (`provider_total_differs_from_lines`), not "fixed". Tax NULL = not provided → shown
  **Pending** (draft) / **Unknown** (finalized), never $0. Void invoices are excluded from all amounts.
* **Reconciliation** `reconcile(tenantId, client, …)`: re-reads the provider through an injected **read-only**
  `AiInvoiceProviderClient` (only `listInvoices`; there is no charge / refund / finalize / void method), records each
  invoice through the same ingest path, writes an `ai_billing_reconciliation_runs` row (counts, status, error). Idempotent
  on the request key. Default client everywhere is `UnconfiguredInvoiceClient` → the run is recorded **failed /
  provider_not_configured** (visible, not a silent zero). Tests and the harness use `FixtureInvoiceClient`.
* **Webhook**: `AiSubscriptionBillingService.ingestRawWebhook` (existing signature-verified path) now also records an
  `invoice.*` Stripe-shaped payload via `mapStripeInvoiceEvent` before the existing status mapping. A failure is logged.
* **Screen** (`ai-usage-screen.repository.ts` + `ai-usage-invoices.view.ts`): `summary.cost.invoiced` and
  `packages/:code → billing.invoiced` return five separate figures — **Recurring subscription price · Estimated
  current-period cost (with `assumptions[]`) · Finalized invoiced amount · Paid · Outstanding** — plus refunds, tax state,
  prorations, the invoice list (number, date, period, status, subtotal, prorations, tax, discounts / credits, total, paid,
  due — only when a record exists), the last run and whether a provider is connected. Owner (`subscription.manage`) only.
* UI: cost overview and Package Details → Billing show the five figures, the assumptions line, the invoice table and
  **Re-check invoices** (sends a request key; message always says "Nothing was charged").

### AI-02 — per-branch operational settings (`modules/ai/src/ai/ai-branch-policy.ts`)
* `tenant_ai_branch_settings` (tenant, branch, package UNIQUE; `override_enabled` NULL = inherit; `settings_json`
  validated per package — booleans only, unknown keys refused; `version`; `updated_by`) + append-only
  `tenant_ai_branch_settings_history`.
* Inheritance: **Global policy → Tenant entitlement → Branch override → User permission**. The gate
  (`evaluateAiAccess`) checks the branch override AFTER the platform switch and the subscription status, so neither can be
  bypassed, and BEFORE permission and the **tenant-wide** quota. New reason `branch_disabled`.
* `KyselyAiAccessRepo.loadSnapshot(tenant, package, user, { branchId })` reads the override when a branch context is
  known (no row → inherit; table missing before 728 → inherit, logged; any other read error → fails closed for that branch,
  logged). Threaded through `AiAccessRepo` / `AiAccessRepoPort` / `AiEntitlementRepo` (optional 4th argument),
  `AIPlatform.run` and `AiProviderTaskGateway` (from `req.branchId`) and the `AiEntitlementGuard` (from the session
  `req.ctx.branchId`).
* Usage attribution: nullable `ai_usage_logs.branch_id`; `KyselyAiUsageLogger` writes it when the gateway passes a
  branch (falls back to the old insert if the column is missing; its previously silent catch is now logged). Older /
  branchless rows stay NULL: the screen says **"branch attribution unavailable"** (or "N not linked to a branch"), never
  a guess. The quota stays one shared tenant allowance (the gate still sums all rows).
* `PUT /tenant/ai/usage-screen/packages/:code/branches/:branchId` (`ai.manage`): branch must be one of the user's
  authorized branches (owner / AI manager: all salon branches; others: session branch + `user_branch_access`) — another
  salon's branch is 404; `expectedVersion` (stale → 409 `AI_STATE_CHANGED`); **On is refused** when the platform turned the
  package off or the salon is not entitled (409 `AI_BRANCH_CANNOT_ENABLE`); Off / Inherit always allowed; a repeat is a
  no-op; settings + history + fail-closed audit (`ai.branch_setting.changed`) in one transaction.
* UI (Package Details → Settings): per authorized branch — **Salon default · Branch override (Inherit / On / Off) ·
  Effective state · Billing scope ("Salon subscription (shared)") · Quota scope ("Shared salon allowance" + this branch's
  use or "attribution unavailable")** · package options · Save. "On" is disabled when not entitled; managers see it read-only.

## 4. Files

Backend — `apps/api/db/migrations/728_ai_invoices_branch_settings.sql` (new); `modules/ai/src/ai/ai-billing-invoices.ts`
(new), `ai-branch-policy.ts` (new), `ai-access-gate.ts`, `ai-access.kysely.repository.ts`, `ai-gateway.ts`,
`ai-platform.ts`, `ai-provider-task-gateway.ts`, `ai-assistant.service.ts`, `ai-gated-completion.ts`,
`ai-subscription-billing.service.ts`, `ai-entitlement/ai-entitlement.guard.ts`, `modules/ai/src/index.ts`;
`modules/super-admin/src/tenant-ai/ai-usage-screen.repository.ts`, `ai-usage-screen.controller.ts`,
`ai-usage-invoices.view.ts` (new), `ai-invoices-branches.pgtest.vitest.spec.ts` (new); `modules/super-admin/src/request-schemas-ai.ts`.
Frontend — `apps/pos-web/src/screens/aiUsageRound2.tsx` (new) + `aiUsageRound2.test.tsx` (new), `POSAiUsageScreen.tsx`,
`apps/pos-web/src/api/posAiUsageApi.ts`, `apps/pos-web/src/i18n/ns/aiusage2.{en,vi}.ts` (94 keys, new) + `ns/index.ts`,
`styles.css` (`.aiu2` block). Docs — `docs/i18n/VI_NEW_STRINGS_FOR_REVIEW.md` (section **A54**), this file; regenerated
`apps/api/openapi/manifest.txt`, `docs/security/SECURITY_ATTACK_SURFACE.md`, `attack-surface-routes.csv`.
Harness — `tooling/catalog-one-screen/aiusage-extra.mjs` (read-only invoice fixture client + SQL probes),
`interact-aiusage.mjs` (3 new steps); results in `tooling/catalog-one-screen/results/r2aiu/`.

## 5. API

| Route | Permission | Notes |
|---|---|---|
| `GET /tenant/ai/usage-screen/summary` | ai.use | `cost.invoiced` (owner only) — the five figures, invoices, last run |
| `GET /tenant/ai/usage-screen/packages/:code` | ai.use | `billing.invoiced` (owner only); `settings.branches` (authorized branches) |
| `PUT /tenant/ai/usage-screen/packages/:code/branches/:branchId` `{overrideEnabled: true\|false\|null, settings, expectedVersion, reason?}` | ai.manage | new |
| `POST /tenant/ai/usage-screen/billing/reconcile` `{idempotencyKey}` | subscription.manage | new; read-only provider re-read; audited `ai.invoices.reconciled` |
| `POST /internal/ai-billing/webhook` (existing) | signature | now also records `invoice.*` snapshots |

## 6. Migration 728 + recovery

Expand-only, idempotent: applied twice to the `aps` test template (second run: all "already exists, skipping"). Creates
`ai_billing_invoice_links`, `ai_billing_invoice_line_snapshots`, `ai_billing_invoice_events` (append-only trigger),
`ai_billing_reconciliation_runs`, `tenant_ai_branch_settings`, `tenant_ai_branch_settings_history` (append-only trigger),
adds nullable `ai_usage_logs.branch_id` + a partial index. Recovery: revert the code — the gate treats missing branch rows
as inherit and the usage logger falls back without the column; the new tables are then unread. Forward-fix only for the
history / event tables (they are evidence). **Not applied to staging or production.**

## 7. Tests actually run (this machine, Oct 30 2026)

* `modules/super-admin/src/tenant-ai/ai-invoices-branches.pgtest.vitest.spec.ts` (new) — **14 / 14 passed**:
  acceptance $59 / -$10 / $3 / $0 → finalized $52, paid $0, due $52, recurring $59 shown apart, not "reconciled", hidden
  from managers; duplicate webhook / unchanged retry / stale older snapshot, lines replaced not doubled, event log
  append-only; refund listed apart; multiple invoices + mid-cycle upgrade prorations; draft → Pending tax, no invoice →
  none, finalized without tax → Unknown; invalid snapshot + unknown tenant rejected; reconciliation (fixture) created /
  unchanged / idempotent key / unconfigured → failed `provider_not_configured`, manager denied, subscriptions and
  `ai_billing_events` untouched; tenant isolation; Stripe-shaped mapping; Branch A on / B off with one subscription and
  95 / 100 shared quota (A hits the shared limit), branch usage 60 / 30 + 5 unattributed, history append-only; no branch id
  → "unavailable"; global disable beats branch enable; expired trial not bypassable (even with a forced row); version
  conflict, invalid settings, permission, other salon's branch, audit failure rollback, no-op repeat, manager sees own branch.
* Existing, re-run: `ai-usage-screen.pgtest` 8/8, `tenant-ai.vitest` 6/6, `ai-admin.vitest` 6/6, `ai-access-kysely.vitest`
  4/4, `ai-usage-unknown.vitest` 9/9, `ai-webhook-dedupe.pgtest` 4/4, `ai-platform.vitest` 36/36,
  `ai-provider-task-gateway.vitest` 9/9, `ai-subscription-billing.vitest` 9/9, `ai-billing-webhook-verify.vitest` 9/9,
  `ai-entitlement.guard.vitest` 20/20, `ai-gated-completion.vitest` 14/14, `ai-cardpointe-billing.vitest` 8/8.
  `ai-pricing-usage-pgtest` 0/4 — **environment only**: it builds its own Kysely with the query builder, which the
  stand-in does not provide ("query builder is not available").
* Harness E2E `node tooling/catalog-one-screen/interact.mjs r2aiu aiusage` — **12 / 12 passed** (the 9 round-1 steps +
  3 new), 0 page errors: r2-1 Billing tab "No finalized invoice yet" → Re-check → $59.00 recurring · $52.00 finalized ·
  $0.00 paid · $52.00 due, tax $3.00 on the row, second re-check 2 unchanged, 2 invoices (no duplicates); r2-2 cost
  overview finalized $101.00 = server summary, assumptions shown; r2-3 Voorhees Off → "Off — this branch", Cherry Hill
  "On", 1 subscription row, history v1, 1 audit row; Business (trial expired) "Off — not subscribed" with "On" disabled.
* `node tooling/catalog-one-screen/measure.mjs r2aiu ai-usage` — **12 / 12 passed** (1920×945 · 1536×729 · 1440×765 ·
  1366×633 × pilot EN / VI / empty), no page scroll.
* Gates: list-queries, tenant-isolation, as-any, role-checks, validated-bodies, async-exports, select-columns,
  impossible-predicate, unreached-routes, silent-catch, audit-writers, pos-i18n, vi-glossary, inert-controls,
  dead-client-methods — all OK; openapi manifest + attack surface regenerated (+2 routes).
* pos-web: `aiUsageRound2.test.tsx` written (5 tests); esbuild syntax check + tsc undefined-name check clean for the
  touched files. **Not run** — pos-web vitest cannot run here.
* **Not run**: CI (no push), staging, a real billing provider, the physical ASUS touchscreen, backend `tsc` (no `@types/node` here).

## 8. Residual risks / gaps

* No real provider client exists: production reconciliation records "provider not connected" until the owner supplies a
  read-only client for their provider (Fiserv CardPointe has no invoice object; Stripe-shaped webhooks are mapped).
  CardPointe charges remain status-only.
* Invoices that bill several AI packages show invoice-level tax / total on each package's tab (lines carry the package);
  tax is not allocated per package.
* Refund amounts come only from the provider snapshot (`amountRefundedCents`); Stripe `charge.refunded` events are not
  folded into the invoice snapshot.
* Branch settings_json options are stored, validated, versioned, audited and shown, but only `override_enabled` is
  enforced by the gate; feature modules do not read the options yet.
* Branch enforcement applies where the caller passes a branch: `AIPlatform.run` / `AiProviderTaskGateway` (`req.branchId`)
  and the entitlement guard (session branch). `AiAssistantService` / `GatedCompletion` callers without a branch stay
  salon-wide. Usage rows before 728 (and from branchless callers) have no branch → "attribution unavailable".
* No scheduled reconciliation job yet (manual "Re-check invoices" only); the runs table supports `scheduled`.

## 9. Owner actions

Review Vietnamese section **A54** in `docs/i18n/VI_NEW_STRINGS_FOR_REVIEW.md`; approve migration 728 for staging; choose
and connect the AI billing provider (read-only invoice access + `AI_BILLING_WEBHOOK_SECRET`) — **Blocked - External
Setup**; run pos-web vitest + the full CI suite; decide whether feature modules should honour the branch options.

Runnable commands:
```
psql -h <host> -U <user> <db> -v ON_ERROR_STOP=1 -f apps/api/db/migrations/728_ai_invoices_branch_settings.sql
FST_PG_TEMPLATE=aps REPO_ROOT=$PWD bash tooling/full-system-test/unit-standin/run.sh $PWD $PWD/modules/super-admin/src/tenant-ai/ai-invoices-branches.pgtest.vitest.spec.ts
node tooling/catalog-one-screen/interact.mjs r2aiu aiusage
node tooling/catalog-one-screen/measure.mjs r2aiu ai-usage
```
