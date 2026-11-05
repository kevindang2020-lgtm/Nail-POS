# AIPowerSalon — Architecture Model at Scale (mapping the "System Design Mastery" poster to your code)

**Target scale:** many nail-salon tenants · **200,000+ customers** · **20,000+ technicians** · read-heavy, spiky at
salon rush hours.
**Method:** every claim below is measured from the current tree (2026-07-03), not assumed. This maps the poster's six
domains — Foundations, API Design, Databases, Caching, Big Data, Production Infra — onto what AIPowerSalon *already
has* and what to build, in order, with capacity math for your numbers.

---

## 0. What the deep scan found (measured, this tree)

| Dimension | Measured | Meaning for scale |
|---|---|---|
| Tables | **430** (`CREATE TABLE`) | Mature relational core; not the thing that breaks first. |
| Migrations | **296** | Disciplined, ordered schema evolution. |
| Indexes | **776**, of which **378** reference `tenant_id` | Strong composite-index base for tenant-partitioned reads. |
| `tenant_id` columns | **840** across the schema | Isolation is pervasive and structural, not bolted on. |
| Endpoints | **~1,620** (Get 753 / Post 723 / Patch 116 / Delete 22 / Put 6) | Large REST surface, per-route permissions. |
| Foreign keys | **168 `REFERENCES`** | Referential integrity enforced in-DB. |
| Connection pool | `PG_POOL_MAX` default **10** | The first real ceiling (see §1). |
| Object storage | `MediaStorage` S3-shaped port (local-disk impl, env-swappable) | CDN/S3-ready by design. |
| Realtime | `realtime.gateway` + Redis `realtime-bus` | Live board updates already off the hot DB path. |
| Background jobs | **45** scheduler/job sites (Redis + `JOBS_SECRET` runners) | Big-data/async seed already present. |
| App state | **stateless** — session from signed cookie/JWT; throttle/cache/rate-limit all Redis-shared | Multi-node & multi-region ready. |
| **Scaling seams added this session** | read/write split (`DATABASE_READ`), pagination caps, Redis read-through cache (dashboard/overview/categories), HTTP cache headers, per-tenant rate limiting | Poster's Caching + Infra tiers are **already wired in code**, off by default. |

**Bottom line:** you are not early. The relational core, isolation, API surface, realtime, and object-storage seams
already match the poster. The scaling tiers the poster shows (read replicas, cache, CDN, rate limits) exist in code as
opt-in seams. What's left is mostly *turning them on with infrastructure* + a few targeted code adds — not a rewrite.

---

## 1. Capacity math for YOUR numbers (why the order below is right)

Your load shape — many small tenants, **200k customers / 20k techs**, dashboards & calendars & queues refreshing
constantly — breaks in a specific order. Sizing it:

- **Row counts are not the threat.** 200k customers + 20k techs +, say, 2–5M appointments/year is *small* for one
  Postgres 16 with your 378 tenant-composite indexes. A tenant's own data (the only thing a POS query touches) is a
  few thousand rows. Sequential scans across all tenants don't happen because every hot query is
  `WHERE tenant_id = ?`.
- **Connections break first.** Each API instance opens up to `PG_POOL_MAX` (10). Run 10 instances for availability →
  100 connections at idle; Postgres degrades in the low hundreds. → **PgBouncer first (Phase 1.1).**
- **Repeated expensive reads break second.** At 200k customers the *reads* (dashboards, overview boards, catalogs,
  discovery) swamp the primary long before writes do. → **replica + cache second (Phases 1.2 / 2) — already coded.**
- **Writes break last, maybe never.** Bookings/checkouts/payments are rare per salon. One primary absorbs them for a
  very long time. → **write sharding is Phase 4, deferred.**

The poster's quadrants, sequenced to *this* math, are below.

---

## 2. Poster → AIPowerSalon, quadrant by quadrant

### 2.1 Foundations (browser/mobile → DNS → LB → web-app → DB)
**Have:** six frontends (pos/admin/owner/tech/customer/customer-display) + a super-admin control plane; stateless
NestJS API; session from signed cookie/JWT. **Build:** put all instances behind a load balancer (they're stateless, so
this is pure ops); health endpoint already exists (`GET /health`) for LB checks. **Status: ready; needs an LB in
front.**

### 2.2 API Design (REST verbs, resources, versioning)
**Have:** ~1,620 endpoints, per-route permission guards, tenant identity server-derived, audit-everywhere. This is the
poster's whole quadrant, already mature. **Build (small, now-safe):** the per-tenant rate limiter added this session
(Phase 3) is the missing "protect the API" piece — turn it on at scale. Consider explicit API versioning
(`/v1/...`) before you expose the API to third-party salon integrations.

### 2.3 Databases (relational schema, FKs, integer money)
**Have:** 430 tables, 168 FKs, integer-cents money (BIGINT), 296 ordered migrations. This is *stronger* than the
poster's toy schema. **Build for scale:**
- **Hot-path index audit (Phase 1.3)** — the one thing I can't do offline: run `EXPLAIN (ANALYZE, BUFFERS)` on a
  synthetic large tenant against the four hottest reads (booking day-grid `pos_tech_appointments` by tenant+date;
  queue state by tenant+status; dashboard/overview aggregates; super-admin oversight) and confirm each hits a
  `(tenant_id, …)` composite. You have 378 such indexes; verify the *plans* use them under realistic data.
- **Time-partition the append-only giants** as they grow: `audit_events`, `audit_logs`, `notifications` are the
  fastest-growing, rarely-read-on-hot-path tables. Monthly range partitioning (or a separate DB) keeps the primary's
  hot tables small. Not urgent at 200k customers; plan the seam now.

### 2.4 Caching (Read/Write split, leader/followers, CDN, object storage) — **the poster's core, largely DONE**
This quadrant is exactly the work implemented this session:
- **Read/write split (leader/followers):** `DATABASE_READ` token + `createReadDatabase()` — reads routed to a replica
  (falls back to primary when unset). Overview/dashboard/reports/super-admin oversight already read from it.
- **Read-through cache:** tenant-scoped Redis cache (`tenant_id` in every key by construction); dashboard + overview
  aggregates (short-TTL self-heal) and service categories (long-TTL + bust-on-write) wired.
- **CDN + object storage:** `MediaStorage` is an S3-shaped port; HTTP `Cache-Control` headers now sit on the public,
  high-volume GETs (branding, salon/tech discovery). Standing up a CDN in front of static bundles + `/media/*` is now
  pure ops.
**Status: coded and off by default; enable with a replica + a Redis + a CDN.**

### 2.5 Big Data (LOG → map → shuffle/reduce → analytics)
**Have:** audit logs, AI reports, 45 scheduler/job sites, async export jobs (billing). This already covers today's
analytics without a streaming pipeline. **Build only when the replica+cache strain** (the roadmap's explicit "don't
build this early"): an event stream off `audit_events` into a warehouse for cross-tenant analytics. For **200k
customers** this is still premature — your dashboards on the replica+cache serve it. Seam to preserve: keep
`audit_events` append-only and partitionable so it can feed a stream later without a migration scramble.

### 2.6 Production Infra (US-West/US-East multi-region, LB, servers, shared storage, per-region DB+cache)
**Have:** stateless app (the hard prerequisite), tenant-scoped data (the other prerequisite). **Build — but late:**
- **Now:** single region, LB + N API instances + PgBouncer + 1 primary + 1–2 read replicas + Redis + CDN. This serves
  *thousands* of salons and your 200k/20k comfortably.
- **Later (only with real geographic spread):** the poster's multi-region model — pin each tenant to a home region
  (tenant → region routing), geo-route at DNS/edge, per-region DB+cache. You already satisfy the architectural
  prerequisite; deploy it late.
- **Never pre-build:** write sharding (Phase 4) and multi-region (Phase 5) until measurements demand them.

---

## 3. The build model, sequenced (what to do, in order)

**Tier A — turn on what's already coded (infra, days not weeks):**
1. **PgBouncer** (transaction pooling) in front of Postgres; point `DATABASE_URL` at it. Biggest single lever, zero
   app change. (Audit for session-level features first; your realtime uses Redis, not `LISTEN/NOTIFY`, so you're
   clear.)
2. **Read replica** + set `DATABASE_REPLICA_URL`. The 5 read surfaces already route to it.
3. **Redis** for the cache + rate limiter + realtime + throttle (one Redis, several features): set `CACHE_STORE=redis`,
   `RATE_LIMIT_STORE=redis`.
4. **CDN** in front of frontends + `/media/*`; the public GETs already send `Cache-Control`.

**Tier B — targeted code (offline-doable, in priority order):**
5. **Hot-path index profiling** (Phase 1.3) on a synthetic large tenant → add/adjust composites where a plan shows a
   scan. *This is the highest-value remaining code work and needs a realistic dataset.*
6. **More cache consumers** — technician roster, plan/feature limits (one-line `getOrSet` each, reusing the cache).
7. **Async job queue/worker** for heavy work (bulk customer import — very relevant at 200k customers — exports, report
   generation) so long jobs never block interactive requests. You have Redis + schedulers; formalize a worker.
8. **Time-partition** `audit_events`/`notifications` before they get large.

**Tier C — deferred until measured (do NOT pre-build):**
9. Write sharding by `tenant_id` (your natural shard key — no cross-tenant joins to break).
10. Multi-region (tenant-pinned).

---

## 4. A concrete target topology for 200k customers / 20k techs / many salons

```
                         [ DNS ]
                            │
                       [  CDN  ]  ── static bundles + /media/*  (edge-served)
                            │
                     [ Load Balancer ]  ── health: GET /health
                            │
        ┌───────────┬───────┴───────┬───────────┐
     [API #1]    [API #2]   …     [API #N]        (stateless NestJS; N for availability+throughput)
        │  each holds a SMALL pool to ↓
                     [  PgBouncer  ]  ── transaction pooling (100s of API conns → few DB conns)
                            │
                 ┌──────────┴───────────┐
            [ Primary DB ]        [ Read Replica(s) ]
             writes + RAW          reads: overview/dashboard/reports/oversight
                                        (DATABASE_READ; lag < 1s, no read-after-write)
                            │
                       [  Redis  ]  ── read-through cache (tenant-scoped) · per-tenant rate limits ·
                                        realtime bus · login throttle   (one cluster, several features)
```

Everything in that diagram except **PgBouncer, the replica, Redis, and the CDN** is already in your codebase. Those
four are infrastructure you provision and point env vars at — no rewrite.

---

## 5. Honest risks / non-obvious cautions
- **Replica lag:** never read-after-write off the replica. The 5 routed surfaces are pure reads (verified zero writes);
  keep booking-create/checkout/check-in read-backs on the primary (they are).
- **Cache = data-isolation surface:** every cache key already embeds `tenant_id` by construction; keep it that way for
  any new consumer. A cross-tenant cache hit is a breach, not a bug.
- **PgBouncer transaction mode** disables session-level Postgres features (`SET`, session advisory locks,
  `LISTEN/NOTIFY`). Audit before switching; you're likely clear (realtime is Redis-based).
- **Index profiling can't be faked offline** — it needs a realistic large tenant. Don't add indexes speculatively;
  measure first (Tier B #5).
- **200k customers is comfortably single-primary.** Resist premature sharding/multi-region; they're the most expensive
  and least necessary steps for your shape.

---

## 6. One-line status per poster quadrant
- **Foundations:** ✅ built; add an LB (ops).
- **API Design:** ✅ mature; rate limiter coded (turn on); consider `/v1` versioning before third-party integrations.
- **Databases:** ✅ strong; profile the 4 hot paths on real data; plan partitioning for the append-only giants.
- **Caching:** ✅ **coded this session** (replica seam + Redis cache + CDN headers); enable with a replica/Redis/CDN.
- **Big Data:** ✅ enough for now (audit logs + AI reports + jobs); don't build streaming until replica+cache strain.
- **Production Infra:** ✅ stateless + tenant-scoped (the hard parts); single-region now, multi-region *only* with real
  geographic spread.

You already own the hard, structural parts of every quadrant. The path to 200k customers / 20k technicians is: **turn
on the four pieces of infrastructure (PgBouncer, replica, Redis, CDN)** that the code is already written for, **profile
the four hot read paths on realistic data**, and **hold the line** against premature sharding and multi-region.
