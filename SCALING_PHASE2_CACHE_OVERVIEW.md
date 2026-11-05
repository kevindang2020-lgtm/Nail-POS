# Scaling Roadmap — Phase 2 (cont.): overview aggregate cache (2026-07-03)

_Third cache consumer, completing the "aggregates" targets the roadmap names. Same short-TTL self-heal pattern as the
dashboard, applied to the POS Overview aggregate — the other heavily-loaded analytical board._

## What I cached and why
`OverviewService` exposes `getState`/`getSummary` plus eight slice endpoints (KPIs, today summary, revenue trend, top
services, top technicians, payment mix, insights, alerts). **Every one of them projects from the same
`repo.getAggregate` call** — so caching that single aggregate serves the whole surface. I added a private `aggregate()`
that reads through the cache and routed `getState`/`getSummary` (and therefore all slices) through it:
`getOrSet({tenantId, branchId}, 'overview:state:'+JSON.stringify(q), 30, () => repo.getAggregate(scope, q))`.

- **30s TTL** (short self-heal), matching the dashboard — appropriate for an analytical board, not a per-event feed.
- **The realtime board is NOT cached.** The live queue/board feeds come from a *separate* service
  (`OverviewBoardService`, realtime bus); only the analytical aggregate is cached, so live updates are unaffected.
- **Composes with Phase 1.2:** the overview repo already reads from `DATABASE_READ`, so this is cache-in-front-of-
  replica — both scaling layers stack. (Routing everything to the read handle also let me drop the now-unused
  `DATABASE` import from the module.)

## Why this is safe
- Optional cache dependency; passthrough when unconfigured (`new OverviewService(repo)` still works — every existing
  test does exactly that).
- Short TTL bounds staleness; tenant+branch in every key bounds blast radius.
- No write path touched; the aggregate is a point-in-time read.

## Verification (fresh runs, this tree)
- **Typecheck:** api `tsc` **0 errors**.
- **New tests:** `overview/overview-cache.vitest.spec.ts` **3/3** — aggregate computed once then `getState` + a slice
  both served from cache; passthrough always computes with no cache; two tenants never share a cached aggregate.
- **Full api suite:** **2564/2564 across 407 files** (was 2561; +3 tests).
- **Build:** api production build **clean**; changed files lint **0/0**.

## Phase 2 cache consumers now wired
1. **Dashboard aggregate** — short-TTL self-heal.
2. **Service categories** — longer-TTL + bust-on-write.
3. **Overview aggregate** — short-TTL self-heal (this ticket), all slice endpoints included.

Remaining named targets (same one-line pattern, when wanted): technician roster (longer TTL + bust on
create/update/status), plan/feature limits (long TTL + bust on plan change). All reuse the `TenantCache` already in
place; none require new infrastructure.
