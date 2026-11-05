# Scaling Roadmap — Phase 3 implemented: per-tenant API rate limiting (2026-07-03)

> **Superseded in part by BUILD_PLAN Phase 11 (2026-10-08, Constitution 4 §12).** The limiter is now **ON by default**:
> in-memory when no Redis is configured, Redis (shared across replicas) when `REDIS_URL` / `RATE_LIMIT_REDIS_URL` is set;
> `TENANT_RATE_LIMIT=off` (or the older `TENANT_RATE_LIMIT_GUARD_DISABLED=true`) turns it off, as does the Super Admin
> toggle set OFF. The budget is **3,000 requests / 60 s per salon location** (tenant + branch), not 600 per tenant: the
> load model in `apps/api/src/common/tenant-rate-limit.vitest.spec.ts` puts one busy location at ≈1,215 req/min from the
> platform's own refresh cadences, so 600 would have refused real checkouts. A 429 carries `code: RATE_LIMITED` and
> `Retry-After`. `RATE_LIMIT_MAX_PER_TENANT` / `RATE_LIMIT_WINDOW_MS` still tune it.

_Continuing the roadmap. Phase 3 (start "alongside Phase 2"): "Extend the Redis throttling you already have (login) to
per-tenant API rate limits, so one busy or misbehaving salon can't exhaust shared capacity." This ticket does exactly
that — a sliding-window limiter over the same Redis technique the login throttle uses, enforced by a global guard,
opt-in and fail-open._

## The noisy-neighbor problem this solves
In a shared multi-tenant API, one salon hammering the service (a runaway script, an aggressive integration, an
accidental tight polling loop) can consume connection and CPU budget that every other salon needs. Per-tenant rate
limiting gives each tenant its own request budget so a busy neighbor is throttled in isolation, not at everyone
else's expense. It pairs with the Phase 1.4 pagination caps (which bound the cost of any *single* request) — together
they bound both request size and request rate per tenant.

## What I built (extends the existing login-throttle pattern)
- **`common/tenant-rate-limit.ts`** — a sliding-window limiter using one Redis **sorted set per tenant** (score =
  request time, out-of-window entries pruned), the exact technique `login-throttle-redis.ts` already uses, so the
  count is accurate and shared across all API nodes.
  - `RedisTenantRateLimiter.hit(tenantId)` → `{ allowed, remaining, limit, retryAfterMs }`.
  - `NoopRateLimiter` (default) allows everything; no ioredis load.
  - `makeTenantRateLimiter()` selects Redis only when `RATE_LIMIT_STORE=redis` + a URL is set.
- **`common/rate-limit.module.ts`** — `@Global()` module exposing the limiter under `TENANT_RATE_LIMITER`.
- **`common/tenant-rate-limit.guard.ts`** — a global `APP_GUARD` (registered *before* the permission guard so an
  over-limit tenant is rejected early). Runs after `TenantContextMiddleware`, so `req.ctx.tenantId` is available.
- **`app.module.ts`** — registers `RateLimitModule` and the guard.

## Safety invariants (identical philosophy to the cache and throttle)
- **OFF BY DEFAULT.** With `RATE_LIMIT_STORE` unset, the limiter is a no-op and the guard is a pass-through — zero
  behavior change, no ioredis loaded. This is why the full suite passes unchanged.
- **FAIL-OPEN.** Any Redis error inside the limiter returns `allowed: true`. A limiter outage must never take the API
  down; the worst case is limiting isn't enforced for a moment, never that good traffic is rejected. A test drives a
  throwing Redis and asserts the request is allowed.
- **Never limits what it shouldn't.** The guard skips requests with no `tenantId` (public/pre-session routes like
  login, media, customer self-signup — the same routes excluded from tenant-context middleware) and never limits
  `SUPER_ADMIN` (the low-volume cross-tenant operator role). So login flows and platform operations are unaffected.
- **Tenant-scoped budget.** The key is the tenant id; each salon has an independent window. One test confirms a busy
  tenant exhausting its budget leaves a quiet tenant fully allowed.

## Behavior when enabled
- Default budget: **600 requests / 60s / tenant** (~10 rps sustained), both tunable via env.
- Over-budget → HTTP **429** with a `Retry-After` header and a JSON body (`retryAfterSeconds`).

## Verification (fresh runs, this tree)
- **Typecheck:** api `tsc` **0 errors**.
- **New tests:** `common/tenant-rate-limit.vitest.spec.ts` **10/10** — allows up to max then blocks; per-tenant
  isolation; remaining-budget accounting; **fail-open** on a throwing Redis; `makeTenantRateLimiter` disabled by
  default; guard passes through when disabled, skips no-tenant and SUPER_ADMIN, allows in-budget, and **throws 429**
  when over budget.
- **Full api suite:** **2561/2561 across 406 files** (was 2551; +10 tests) — the global guard registration is proven
  safe because, disabled by default, it's a pass-through for every existing test.
- **Build:** api production build **clean**; new files lint **0/0**.

## How to turn it on (ops, no code change)
1. Point at a Redis (reuse the one you already run).
2. Set `RATE_LIMIT_STORE=redis` and `RATE_LIMIT_REDIS_URL` (or reuse `REDIS_URL`). Optionally tune
   `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX_PER_TENANT`.
3. Deploy. Each tenant gets its window budget; roll back by unsetting `RATE_LIMIT_STORE`.

## Roadmap status
- Phase 1.2 (read/write split): ✅ · Phase 1.4 (pagination caps): ✅
- Phase 2 (read-through cache): ✅ (dashboard + service categories; more consumers are one-line adds)
- **Phase 3 (per-tenant rate limiting): ✅ (this ticket)** — the roadmap also suggests giving heavy async work
  (bulk import, exports, report generation) its own job queue/worker so long jobs don't block interactive requests;
  that's a natural follow-up now that the interactive path is protected.
- Phase 1.1 (PgBouncer) / 1.3 (index profiling): infra / live-EXPLAIN — out of scope offline.
- Phase 4 (shard writes) / Phase 5 (multi-region): correctly deferred; not needed at current load.

The Phase 1–3 code seams the roadmap called for are now all in place and ship dark (each opt-in, reversible, off by
default). What remains is infrastructure (PgBouncer, a replica, a Redis, a CDN) and live profiling — turned on with
env/DNS, not code.
