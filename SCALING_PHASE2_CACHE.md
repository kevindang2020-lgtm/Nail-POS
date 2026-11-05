# Scaling Roadmap — Phase 2 implemented: tenant-scoped read-through cache (2026-07-03)

_Continuing the roadmap in order. Phase 2 calls for a Redis read-through cache on heavy, staleness-tolerant reads,
with the hard invariant that `tenant_id` is in every cache key. This ticket builds that cache, wires it into the
dashboard aggregate as the first consumer, and ships it opt-in with a transparent passthrough default._

## Design — follows the existing Redis conventions exactly
The codebase already has an opt-in Redis pattern (realtime bus, login throttle): a feature flag + `*_REDIS_URL ||
REDIS_URL`, ioredis loaded lazily via `common/redis.ts`, graceful fallback when unset. The cache mirrors it:
- **`common/tenant-cache.ts`** — `TenantCache` interface with `getOrSet(ctx, key, ttl, loader)`, `invalidate`,
  `invalidateTenant`.
  - **`NoopTenantCache`** (default): a transparent passthrough — `getOrSet` just runs the loader. Dev, tests, and
    single-node deployments are unaffected and never load ioredis.
  - **`RedisTenantCache`**: read-through with `EX` TTLs.
  - **`makeTenantCache()`**: returns Redis when `CACHE_STORE=redis` + a URL is set, else the passthrough.
- **`common/cache.module.ts`** — a `@Global()` module exposing the cache under the `TENANT_CACHE` token, registered
  in `app.module.ts` next to `DatabaseModule`.

## The security invariant, enforced by construction
**Every cache key embeds the tenant id (and branch when present)** via `scopedKey(ctx, key)` →
`aps:cache:t=<tenantId>:b=<branchId>:<key>`. Callers pass a `CacheCtx { tenantId, branchId? }` and cannot bypass the
prefix, so a cache entry written for tenant A is physically unreachable by tenant B. A cross-tenant cache hit is
impossible, not merely discouraged — this is treated with the same seriousness as server-derived tenant identity. A
dedicated test asserts two tenants asking for the *same logical key* land on *different physical keys* and never see
each other's data.

## Fail-open, never fail-wrong
Redis is a performance optimization, never a correctness dependency:
- Any error on a cache **read** → fall through to the loader (return live data uncached).
- Any error on a cache **write** → the freshly-loaded value is still returned; the write was best-effort.
- `undefined` is never cached (a miss is never memoized as a hit).
So a Redis outage degrades to "same as no cache," never to a failed or stale-wrong request. A test drives a throwing
Redis and confirms the loader result is returned.

## First consumer — POS dashboard aggregate
`dashboard.service.ts` now takes an optional `TenantCache` and wraps the aggregate read:
`getOrSet({tenantId, branchId}, 'dashboard:state:'+JSON.stringify(q), 30, () => repo.getAggregate(scope, q))`.
- **30-second TTL** — short enough that the KPI board self-heals within seconds even without explicit invalidation,
  long enough to absorb rush-hour refresh storms and repeated loads.
- The key includes the **query shape** (range/period), so `?range=today` and `?range=month` cache separately.
- The module factory threads `TENANT_CACHE` in via `inject: [DASHBOARD_REPO, TENANT_CACHE]`. The constructor param is
  optional, so every existing `new DashboardService(repo)` in tests keeps working (passthrough).
- The dashboard repo already reads from `DATABASE_READ` (Phase 1.2), so this is cache-in-front-of-replica: the two
  scaling layers compose.

## Why this is safe
- **Off by default = zero behavior change.** With `CACHE_STORE` unset, `getOrSet` runs the loader exactly as before.
- **Short TTL + tenant-scoped keys** bound both staleness and blast radius.
- **No write path is cached**; only the dashboard aggregate read, which is inherently a point-in-time summary.

## Verification (fresh runs, this tree)
- **Typecheck:** api `tsc` **0 errors**.
- **New unit tests:**
  - `common/tenant-cache.vitest.spec.ts` **7/7** — passthrough runs the loader every call; read-through caches a miss
    then serves the hit; **tenant isolation** (two tenants → distinct physical keys, A never sees B); branch in key;
    `invalidateTenant` clears one tenant only; **fail-open** on a throwing Redis.
  - `dashboard/dashboard-cache.vitest.spec.ts` **3/3** — service computes the aggregate once then serves cache;
    without a cache always computes; two tenants never share a cached aggregate.
- **Full api suite:** **2547/2547 across 404 files** (was 2537; +10 cache tests).
- **Build:** api production build **clean**; new files lint **0/0**.

## How to turn it on (ops, no code change)
1. Have a Redis reachable (you already run one for realtime/throttle).
2. Set `CACHE_STORE=redis` and `CACHE_REDIS_URL` (or reuse `REDIS_URL`). Optional `CACHE_PREFIX`.
3. Deploy. The dashboard aggregate begins serving from a 30s tenant-scoped cache; roll back by unsetting `CACHE_STORE`.

## Roadmap status
- Phase 1.2 (read/write split): ✅  ·  Phase 1.4 (pagination caps): ✅  ·  **Phase 2 (read-through cache): ✅ (this
  ticket, first consumer wired)**.
- Phase 1.1 (PgBouncer) and 1.3 (index profiling) remain infra / live-EXPLAIN work.

## Natural next steps (all incremental now that the cache exists)
- **Add more consumers**: overview aggregate, service catalog, technician roster, plan/feature limits — each is a
  `getOrSet` wrap with an appropriate TTL, reusing this exact cache. Catalogs can take longer TTLs (minutes) since
  they change rarely; add bust-on-write via `invalidate`/`invalidateTenant` in the corresponding write paths.
- **Phase 2 (HTTP layer)**: `Cache-Control`/`ETag` on the same GETs, and a CDN in front of static/customer surfaces.
- **Phase 3**: per-tenant API rate limits (protects a noisy tenant from starving others), which pairs naturally with
  the pagination caps already in place.
