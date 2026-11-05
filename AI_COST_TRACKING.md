# AI cost tracking — token usage → COGS per package

## The gap this closes
`ai_usage_logs.cost_estimate_cents` was hardcoded to `0` — token counts were logged but never costed, so there was no
visibility into what each AI package actually costs to run. (Flagged in the Phase 3 report: `AI_COST_TRACKING_ENABLED`
reserved, not consumed.) This implements it. Costs are tiny per call (a fraction of a cent), so integer cents rounds to
zero — the fix stores **micro-USD** (1e-6 USD) integers for real precision.

## Files
- `apps/api/src/ai/ai-pricing.ts` (new) — per-model price table (USD/1M tokens) + `computeAiCostMicroUsd` + `formatMicroUsd`
- `apps/api/db/migrations/093_ai_usage_cost.sql` (new) — `ai_usage_logs.cost_micro_usd BIGINT`
- `apps/api/src/ai/ai-gateway.ts` — `AiUsageEntry.costMicroUsd`
- `apps/api/src/ai/ai-assistant.service.ts` — computes cost (success calls only) before logging
- `apps/api/src/ai/ai-access.kysely.repository.ts` — writes `cost_micro_usd` (+ a coarse `cost_estimate_cents` view)
- `apps/api/src/super-admin-ai/ai-admin.repository.ts` — usage summary now sums `cost_micro_usd` per package/status
- `apps/api/src/ai/ai-pricing.vitest.spec.ts` (new) — 5 tests

## How it works
The per-model table holds USD per 1M input/output tokens for the Phase-3 default models (gpt-4o-mini, claude-3-5-haiku,
gemini-1.5-flash) plus common alternates, with a conservative fallback so unknown models don't read as free. On each
**successful** call the service computes `inTok*inPerM + outTok*outPerM` (= micro-USD), and the logger stores it; blocked
or errored calls cost nothing (they never reached a provider), so they log 0. The Super-Admin usage summary aggregates
`sum(cost_micro_usd)` alongside calls and usage, giving per-package COGS.

Prices are **approximate** — edit `AI_MODEL_PRICES` to your providers' current rates. They're a config knob, not hardcoded
business logic; the computation and accumulation are what's structural here.

## Verification
API: `tsc` clean; **564 tests** (+5: token×price math for a known model; unknown-model fallback + free mock; micro-USD
formatting; the service records a cost on an allowed call and never on a blocked one); `RESULT: PASS`. The Mock is priced
at 0, so this changes no existing test outcome until a real (priced) provider is configured.

## Note
The API now returns `costMicroUsd` in the Super-Admin AI usage summary; surfacing it as a dollar figure in the
`AiSubscriptionsScreen` usage view is a small one-line UI add (format with `formatMicroUsd`). Point-in-time pricing
(snapshotting the rate at write-time vs. the current table) is a possible later refinement.

## Platform status (sandbox-verifiable work complete)
Backend **564** · admin-web **97** · owner-web **23** · pos-web **67** — all `tsc`/build clean. The remaining items are
all environment-bound: a real provider call (your key), a real billing webhook (your secret + payload mapping + a
delivered event), the outbound charge-initiation flow, and purpose-built surfaces for the 7 assistants with no POS home.
