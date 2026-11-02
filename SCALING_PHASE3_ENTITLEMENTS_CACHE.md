# Scaling Roadmap — Phase 3 (finish): read-through cache on plan entitlements (2026-07-03)

_Phase 3's cache infra (`TenantCache`, tenant-scoped, fail-open) and rate limiting were built, and the hot dashboards/
overview/categories were already cached. This ticket extends the cache to the last obvious hot read: PLAN ENTITLEMENT
resolution, which runs on many gated actions across the app. As with the Phase 2 replica expansion, the discipline is
what makes it safe — cache only the slow-changing slice, never the live one._

## What changed
`EntitlementsService.resolveContext()` previously issued 5+ DB reads on every entitlement check (plan text, catalog
mapping, plan limits, plan feature states, plus tenant overrides + live usage). It now caches ONLY the **plan config**
slice — catalog + plan limits + plan feature states — via a new `resolvePlanConfig()` that wraps those reads in
`cache.getOrSet(...)`.

- Cache key: `plans:config:<planText>`, tenant-scoped (the cache embeds `tenant_id` by construction).
- TTL: **60s**, self-healing.
- Cache is `@Optional()`-injected — with no cache configured (the default `NoopTenantCache`), the service behaves
  exactly as before (passthrough), so this is a pure no-op until `CACHE_STORE=redis` is turned on.

## The honest boundary — what is deliberately NOT cached
This is the crux. `resolveContext` mixes slow-changing config with live, decision-driving data. Caching the wrong part
would be a correctness bug, not just a staleness annoyance:

| Data | Changes | Cached? | Why |
|---|---|---|---|
| catalog mapping, plan limits, plan feature states | rarely (only on super-admin plan edits) | **YES** | hot read, staleness-tolerant |
| tenant limit/feature **overrides** | occasionally, per tenant | **NO** | tenant-specific; small; correctness-sensitive |
| **live usage counts** (`getUsedCounts`) | constantly (every resource created) | **NO** | these drive allow/deny — a stale count could wrongly permit or block creating a branch/customer |

Caching `getEntitlements` wholesale would have frozen usage counts and risked letting a tenant exceed a hard limit (or
being blocked under it). So only the plan-config reads are cached; usage is always live. The test asserts exactly this:
plan config loads once across two checks, while the usage count still reflects a fresh read on the second call.

## Why TTL-only (no proactive bust) is correct here
Plan config is keyed by `planText` and edited by `planId` in `plans.service.updatePlanLimits`. Because the cache is
tenant-scoped, there's no clean cross-tenant key to bust on a plan edit. The **60s self-healing TTL** handles this
correctly: a plan-limit change propagates to all tenants on that plan within 60s. For plan config (edited rarely, by
super-admins, non-urgent) a bounded 60s staleness is the right trade — simpler and complete, versus a partial
per-tenant bust that couldn't reach every affected tenant anyway.

## Verification (fresh runs)
- **Typecheck:** api `tsc` **0 errors**.  **Lint:** changed files **0**.
- **New tests:** `entitlements-cache.vitest.spec.ts` **3/3** — (1) plan config cached once while usage stays live;
  (2) no-cache = passthrough (loaded each call); (3) same tenant+plan reuses the entry.
- **Plans/entitlements suite:** 35 → 38 passing.
- **Full api suite:** **2575/2575 across 410 files** (was 2572/409).
- **Build:** api production build **clean**.

## Files changed
- `apps/api/src/super-admin-plans/entitlements.service.ts` — `@Optional()` cache; `resolvePlanConfig()` caches the
  plan-config slice (60s); usage/overrides untouched.
- `apps/api/src/super-admin-plans/super-admin-plans.module.ts` — inject `TENANT_CACHE` into the factory.
- `apps/api/src/super-admin-plans/entitlements-cache.vitest.spec.ts` — new.

## Phase 3 status — cache coverage now
Hot reads on the read-through cache: dashboard aggregate, overview aggregate, service categories, **plan entitlements
config** (this ticket). Rate limiting + import worker already done. Turning it on remains one flag (`CACHE_STORE=redis`)
with graceful fail-open. The remaining cacheable surfaces (e.g. technician roster) are lower-frequency; the
highest-value hot reads are now covered.
