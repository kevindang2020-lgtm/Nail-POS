# AIPowerSalon — System Design Mastery, mapped to your codebase

**Target scale:** 1,000+ salons · 200,000+ customers · 20,000+ technicians.
**Method:** every number below was measured from the repo on 2026-07-03, not estimated. This maps the poster's six
pillars — Foundations · API Design · Databases · Caching · Big Data · Production Infra — onto what AIPowerSalon
*already is*, grades each pillar for your scale, and gives a sequenced build plan.

**Headline:** you are much further along than the poster's "getting started" framing implies. Five of the six pillars
are already at or near production-grade for your target scale. The gaps are **infrastructure you turn on** (a replica,
PgBouncer, a CDN, a Redis) and **one genuinely new build** (a Big-Data/event pipeline) — not app rewrites. The
architecture already has the right seams, and over the last sessions the Phase 1–3 scaling seams were added in code.

---

## Scorecard (measured)

| Poster pillar | AIPowerSalon today | Grade for 1k salons / 200k customers / 20k techs |
|---|---|---|
| **Foundations** (clients, HTTP, DNS, app servers, DB) | 9 frontends + 1 API (140 NestJS modules), stateless app, session-derived tenant identity | ✅ Strong |
| **API Design** (REST, methods, auth) | **1,620 endpoints** (753 GET / 723 POST / 116 PATCH / 22 DELETE / 6 PUT), per-route permissions, audit-everywhere | ✅ Strong |
| **Databases** (relational schema, keys) | **296 migrations · 430 tables · 776 indexes · 265 composite `(tenant_id,…)` indexes**, money = integer cents (BIGINT), 278 tenant-scoped files | ✅ Strong |
| **Caching** (read APIs, LB, read/write split, leader/followers, CDN, object storage) | Read/write split seam, Redis read-through cache (3 consumers), per-tenant rate limiter, HTTP cache headers, media-storage port | 🟡 Seams built in code; **infra not yet turned on** |
| **Big Data** (log/event stream → analytics) | Audit events + AI reports/insights + 44 schedulers; **no streaming/event pipeline** | 🔴 The one real build (and correctly deferred until dashboards strain) |
| **Production Infra** (multi-region, LB, per-region DB+cache, shared storage) | Stateless app, Redis-fan-out realtime, health endpoints; single-region | 🟡 Single-region is correct for now; multi-region is a late phase |

---

## Pillar 1 — Foundations  ✅

**Poster:** web browser / mobile app → HTTP → DNS → app servers → database.

**You have:** nine distinct frontends — `pos-web`, `admin-web`, `owner-web`, `tech-web`, `customer-web`,
`customer-display`, `go-check-in-kiosk`, `go-check-in-admin`, `manager-pay-web` — over one NestJS API of **140
modules**. The app is **stateless** (tenant identity is derived server-side from the signed session on every request,
never trusted from the client), which is the single most important property for horizontal scaling: you can run N API
instances behind a load balancer and any instance can serve any request. I verified there is **no shared in-process
state** that would break multi-node — the only in-memory `Map`s are local query-grouping and the in-memory dev
adapter, and the one public-discovery IP throttle is acceptably per-node (the *tenant* rate limiter is Redis-backed and
shared).

**Grade: Strong.** Nothing to build here for scale; this is the foundation the rest rests on.

---

## Pillar 2 — API Design  ✅

**Poster:** REST resources, HTTP verbs (GET/POST/PUT/DELETE), an API gateway.

**You have:** **1,620 endpoints** with a clean verb distribution (753 GET, 723 POST, 116 PATCH, 22 DELETE, 6 PUT),
**per-route permission guards** (`@RequirePermission`), and audit logging across 154 modules. Payment surface is
correctly **isolated to Fiserv/CardPointe/Bolt + Clover** — I re-verified there is no Stripe/Square *integration*; the
only matches are isolation guards ("never surfaced") and Stripe-*style* HMAC webhook signature verification (a signing
scheme, not a processor).

**For scale, two additive API concerns (now handled):**
- **Unbounded reads** — closed (Phase 1.4): a shared `clampPageSize` caps every paginated read at 100 rows, so no
  large salon can pull an unbounded set.
- **Noisy neighbors** — closed (Phase 3): a per-tenant Redis rate limiter (sliding window) behind a global guard, so
  one busy salon can't exhaust shared capacity. Off by default, fail-open.

**Grade: Strong.** The "API gateway" box on the poster maps to your load balancer + these guards.

---

## Pillar 3 — Databases  ✅

**Poster:** relational schema, primary/foreign keys, `CREATE TABLE`, normalized design.

**You have:** **296 migrations** producing **430 tables** with **776 indexes**, of which **265 are composite
`(tenant_id, …)`** — exactly the shape multi-tenant reads need. Money is integer cents in BIGINT columns (221 BIGINT
declarations), so no floating-point currency bugs. Tenant scoping is pervasive (278 files, 3,784 `tenant_id`
references) and server-derived.

**Capacity reality at your scale:** a single well-tuned Postgres 16 handles thousands of small tenants comfortably. The
math that matters: 1,000 salons × ~200 appointments/day × 365 ≈ **73M appointment rows/year** — large but ordinary for
one indexed Postgres instance. What breaks *first* is never raw size; it's **connection count**, then **repeated
expensive reads**. Both are addressed below in Caching. The one table family that grows without bound —
`audit_events` / `audit_logs` / `notifications` — is the right candidate for **time-based partitioning** later (Phase
4 interim lever), because it's append-heavy and rarely read on the hot path.

**Grade: Strong.** No schema rewrite is needed at any point on this roadmap; the tenant-partitioned design is already
the shard-ready shape if you ever reach Phase 4.

---

## Pillar 4 — Caching  🟡 (seams built in code; infra to turn on)

**Poster:** Read APIs vs Write APIs, load balancer, **leader/followers** (read replicas), CDN, object storage.

This is the pillar that matters most at your scale, and the **code seams are now all in place** (built over the last
sessions; each opt-in, reversible, off by default):

- **Read/write split — the poster's leader/followers.** A `DATABASE_READ` token routes read-only, latency-tolerant
  surfaces (overview, dashboard, reports, super-admin oversight) to a replica, falling back to the primary when no
  replica is configured. Writes and read-after-write stay on the primary leader.
- **Read-through cache — the poster's cache tier.** A tenant-scoped Redis read-through cache with **`tenant_id` in
  every key by construction** (a cross-tenant hit is impossible), fail-open, off by default. Three consumers wired:
  dashboard aggregate (30s self-heal), overview aggregate (30s), service categories (5-min + bust-on-write).
- **CDN + object storage — the poster's CDN and object-storage boxes.** Media already sits behind a **swappable
  `MediaStorage` port** (local disk today, S3/GCS by env with identical keys/URLs). HTTP `Cache-Control` headers are
  now on the public, high-volume GETs (platform branding, salon/tech discovery), so a CDN can serve them from the edge.
- **Per-tenant rate limiting** (poster's implicit "protect the shared tier").

**What's left here is infrastructure, not code:**
1. **PgBouncer** in front of Postgres (transaction pooling) — the single highest-leverage step. Point `DATABASE_URL`
   at it. Pure ops.
2. **Stand up a read replica**, set `DATABASE_REPLICA_URL` — the 5 read surfaces immediately use it.
3. **Turn on Redis caching** (`CACHE_STORE=redis`) — you already run Redis for realtime/throttle.
4. **Put a CDN** in front of static frontends, `/media/*`, and the cache-headed public GETs.

**Grade: 🟡 → ✅ the day the infra is switched on.** The app is ready; nothing further to write for the core caching
story.

---

## Pillar 5 — Big Data  🔴 (the one genuine build — and correctly deferred)

**Poster:** LOG → fan-out workers → aggregation/reduce → analytics/charts (a streaming pipeline).

**You have** the *inputs* already: audit events, AI reports/insights, scheduled reports, and 44 background
schedulers. What you **don't** have is a streaming/event pipeline (Kafka/Kinesis-style ingest → stream processors →
a columnar analytics store). And per the roadmap, **you shouldn't build it yet** — your current analytics (dashboards
on the replica + cache, plus AI reports) cover today's needs, and a big-data pipeline is expensive to run and operate.

**When to build it:** when dashboards-on-replica + cache actually strain, or when you need cross-tenant, long-horizon
analytics that would be too heavy to compute on the operational DB. **The right first step when that day comes** isn't
Kafka — it's:
1. Move the append-only giants (`audit_events`, `audit_logs`, `notifications`) to **time-based partitioning** and/or a
   separate analytics database, so they stop competing with hot-path reads.
2. Add an **event-stream emitter** (the existing audit/event write is the natural tap) into a durable log.
3. Only then add stream processors + a columnar store (ClickHouse/BigQuery-style) if the volume demands it.

**Grade: 🔴 by presence, but this is the *correct* gap** — building it now would be premature scaling.

---

## Pillar 6 — Production Infra  🟡 (single-region is right; multi-region is last)

**Poster:** US-West / US-East, geo load balancer, per-region servers + DB + cache, shared storage.

**You have** the hard prerequisite already: a **stateless app** (runs anywhere), a **Redis-fan-out realtime bus** (so
board/queue live updates work across multiple API nodes), health endpoints, and tenant-scoped data (the natural
region-pinning key). One region with a replica + backups + failover serves thousands of salons for a very long time.

**What multi-region needs (Phase 5, last):** pin each tenant to a home region (tenant → region routing), geo-route at
the edge, per-region DB + cache. **Design for it now, deploy it late** — you already satisfy the architectural
prerequisites (stateless app, tenant-scoped data), so this stays a future ops project, not a rewrite.

**Grade: 🟡 — deliberately.** Multi-region for resilience alone would be premature; a single region with replicas +
backups is simpler and sufficient now.

---

## The build plan (sequenced, with triggers)

Do these in order; each has a **trigger** so you don't build ahead of need. Nothing here rewrites the app.

**Now (pure infra, highest leverage):**
1. **PgBouncer** in front of Postgres. Trigger: before onboarding at scale. Fixes connection exhaustion first.
2. **Read replica** + set `DATABASE_REPLICA_URL`. Trigger: same. The read seam is already coded.
3. **Turn on Redis cache** (`CACHE_STORE=redis`) and **rate limiting** (`RATE_LIMIT_STORE=redis`). Trigger: same —
   both are one env flag.
4. **CDN** in front of frontends, `/media/*`, and the public cache-headed GETs. Trigger: same.

**Soon (small code, offline-doable):**
5. **Add cache consumers** as reads get hot: technician roster, plan/feature limits (each a one-line `getOrSet` +
   bust-on-write). Trigger: a specific read shows up hot on the replica.
6. **Profile the 4 hot read paths** (`EXPLAIN (ANALYZE, BUFFERS)` on a large synthetic tenant): booking day-grid,
   queue state, dashboard/overview aggregates, super-admin oversight; add/adjust composite indexes where a plan shows
   a sequential scan. Trigger: needs a large tenant's data — this is the one thing that can't be done offline.
7. **Async job workers** for heavy work (bulk import, exports, report generation) on the existing Redis, so long jobs
   never block interactive requests. Trigger: exports/imports start affecting p95 latency.

**Later (only if measurements demand):**
8. **Partition the append-only giants** (`audit_events`/`audit_logs`/`notifications`) by time. Trigger: those tables
   dominate storage or slow the hot path.
9. **Big-data/event pipeline.** Trigger: dashboards-on-replica + cache strain, or heavy cross-tenant analytics.
10. **Shard writes by `tenant_id`.** Trigger: primary *write* throughput saturates after all the above (likely never).
11. **Multi-region.** Trigger: real geographic concentration needing low latency + regional failover.

---

## Bottom line for your scale

At 1,000 salons / 200k customers / 20k technicians, the load is **many small read-heavy tenants** — served by **read
scaling and caching**, which is exactly what's now in place in code. Your realistic path to that scale is: **PgBouncer +
replica + Redis cache + CDN** (all infra, all ready to switch on), then **index profiling** on real data, then **async
workers**. Write sharding and multi-region are correctly far off and may never be needed. You are not missing
architecture — you're missing turned-on infrastructure, and one big-data pipeline you shouldn't build until the
dashboards tell you to.

_See the companion `SCALING_*.md` files for the exact code already shipped for each seam, and `SCALING_ROADMAP.md` for
the trigger-by-trigger detail._
