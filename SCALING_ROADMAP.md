# AIPowerSalon — Scaling Roadmap (planning for 1,000+ salons)

This roadmap maps the "System Design Mastery" model (Foundations, API Design, Databases, Caching,
Big Data, Production Infra) onto **what AIPowerSalon already has** and **what to build, in order**, to
serve 1,000+ nail salons with many customers and technicians each.

It is deliberately sequenced. Each phase has a **trigger** (when to start it) so you don't build
expensive infrastructure before you need it. Nothing here requires rewriting the app — the architecture
is already multi-tenant with the right seams.

---

## Where you are today (measured from the codebase)

| Capability | Status | Evidence in repo |
|---|---|---|
| Multi-tenant isolation | ✅ Strong | 143 tenant-scoped columns; tenant identity server-derived, never trusted from client |
| Relational schema | ✅ Strong | 296 migrations, 427 tables, integer-cents money, proper foreign keys |
| Indexing | ✅ Good base | 776 indexes; 265 composite `(tenant_id, …)` indexes |
| REST API | ✅ Strong | ~1,765 endpoints, per-route permissions, audit-everywhere |
| Object/file storage | ✅ Abstracted | `MediaStorage` port (avatars, receipts) — swappable to S3/GCS |
| Realtime | ✅ Wired | `realtime.gateway` + `realtime-bus` (queue/board live updates) |
| Redis | ✅ Present | login throttle, AI insights, revenue-split; ready to reuse for caching |
| Background jobs | ✅ Present | schedulers for reminders, AI trial sweep, announcements, billing |
| **Connection pooling (external)** | 🔴 Missing | app pool only (`PG_POOL_MAX=10`); no PgBouncer |
| **Read replicas / read-write split** | 🔴 Missing | single `DATABASE` token injected in 138 files (clean seam to split) |
| **Read-through cache** | 🟡 Partial | Redis used for auth/misc, not for hot reads (dashboards, catalogs) |
| **CDN** | 🟡 Likely at host edge | frontends + `/media` should sit behind a CDN |
| **Streaming/analytics pipeline** | 🔴 Not yet | audit logs + AI reports exist; no log/event stream |
| **Multi-region** | 🔴 Not yet (correctly) | one region serves thousands of salons |

**Reading of the load shape:** many tenants, each small-to-medium, **read-heavy** (dashboards,
booking calendars, queues that refresh constantly), **spiky at salon rush hours**. This shape is served
by *read scaling and caching first* — not by sharding writes, and not by multi-region.

---

## Capacity math (why the order below is right)

A single well-tuned Postgres 16 instance comfortably handles **thousands of small tenants**. The first
thing that breaks is almost never raw data size — it's **connection count** and **repeated expensive
reads**, in that order:

- Each API instance opens up to `PG_POOL_MAX` (10) connections. Run 10 API instances for availability and
  you're at 100 connections before any load; Postgres degrades in the low hundreds. → **pooling first.**
- Dashboards, calendars, oversight, and reports are read-dominated and re-fetched constantly. At 1,000+
  salons these reads swamp the primary long before writes do. → **replicas + cache second.**
- Writes (bookings, checkouts, payments) are comparatively rare per salon. A single primary absorbs them
  for a very long time. → **write sharding is Phase 4, and may never be needed.**

---

## Phase 1 — Make one primary Postgres last  *(start now; highest leverage, lowest cost)*

**Trigger:** you're planning for 1,000+ — start this before onboarding at scale.

1. **PgBouncer (transaction pooling) in front of Postgres.**
   Lets many API instances share a small number of real Postgres connections. This is the single most
   important scaling step and it's pure infrastructure — no app changes. Point `DATABASE_URL` at PgBouncer
   instead of Postgres directly.
   - Caveat to document for the team: transaction-mode pooling disables session-level features
     (`SET`, session advisory locks, `LISTEN/NOTIFY`). Audit for these before switching. Your realtime bus
     uses Redis, not Postgres `LISTEN/NOTIFY`, so that's clear.

2. **Read replica + read/write split at the `DATABASE` seam.**
   The `DATABASE` token is injected in ~138 files, so this is a *targeted* change, not a rewrite:
   - Introduce a second token (e.g. `DATABASE_READ`) bound to a replica connection string
     (`DATABASE_REPLICA_URL`), falling back to the primary when unset (so local/dev is unaffected).
   - Route **read-only, latency-tolerant** endpoints to the replica: overview/dashboards, super-admin
     oversight aggregates, reports, catalog/technician lists. Keep all writes and read-after-write flows
     (checkout, booking create/reschedule) on the primary.
   - Accept and document **replication lag** (usually < 1s): never read-after-write off the replica.

3. **Hot-path index audit.**
   Verify every high-frequency query hits a composite `(tenant_id, …)` index. Prime suspects to profile
   with `EXPLAIN (ANALYZE, BUFFERS)` under realistic tenant data:
   - Booking day-grid (`pos_tech_appointments` by tenant + date)
   - Queue state (waiting/serving by tenant + status)
   - Dashboard KPIs / overview aggregates
   - Super-admin oversight (cross-tenant, but still tenant-partitioned reads)

4. **Pagination + query caps everywhere.**
   Ensure no endpoint can return an unbounded set for a large salon. Enforce a max page size server-side;
   reject/period-bound expensive range queries.

**Exit criteria:** primary connection count flat under load; p95 read latency stable as tenants grow.

---

## Phase 2 — Add the cache tier the poster shows  *(start when read latency climbs)*

**Trigger:** replica reads still show hot spots, or dashboard/catalog reads dominate DB CPU.

1. **Redis read-through cache for expensive, staleness-tolerant reads.**
   You already run Redis, so this is incremental. Cache: dashboard aggregates, service catalogs,
   technician lists, plan/feature limits.
   - **Cache key MUST include `tenant_id`** (and branch where relevant) — a cross-tenant cache leak is a
     data-isolation breach. Treat this as a security invariant, same as server-derived tenant identity.
   - **Invalidate on write:** when a service/tech/schedule changes, bust that tenant's keys. Prefer short
     TTLs (30–120s) for aggregates so staleness self-heals even if an invalidation is missed.

2. **CDN in front of static frontends and `/media/*`.**
   Built pos/admin/owner/etc. bundles and all media (avatars, receipts) should be served from a CDN, never
   from the API. This offloads the largest volume of requests entirely.

3. **HTTP caching headers** on cacheable GETs (catalogs, static config) so browsers and the CDN cooperate.

**Exit criteria:** DB read load drops sharply; dashboards feel instant regardless of tenant count.

---

## Phase 3 — Per-tenant rate limiting & isolation of noisy neighbors  *(start alongside Phase 2)*

**Trigger:** any single salon's traffic can degrade others.

- Extend the Redis throttling you already have (login) to **per-tenant API rate limits**, so one busy or
  misbehaving salon can't exhaust shared capacity.
- Give heavy async work (bulk customer import, exports, report generation) its own **job queue + worker**
  (you already have schedulers and Redis), so long jobs never block interactive requests.

---

## Phase 4 — Scale writes only if the primary saturates  *(likely far away; may never be needed)*

**Trigger:** primary **write** throughput (not reads) is the bottleneck after Phases 1–3.

- **Shard by `tenant_id`.** Your data is already tenant-partitioned everywhere, so tenant is the natural
  shard key: route each salon to a shard, keep a small routing table (tenant → shard). No cross-tenant
  joins exist to break.
- This adds major operational cost (migrations across shards, backups, rebalancing). **Do not pre-build
  it.** Design Phase 1–3 so it *could* be added, and add it only when measurements demand it.
- Interim lever before sharding: move the biggest append-only, write-heavy tables (`audit_events`,
  `audit_logs`, `notifications`) to **time-based partitioning** and/or a separate database, since they
  grow fastest and are rarely read on the hot path.

---

## Phase 5 — Multi-region  *(last; only with real geographic concentration)*

**Trigger:** thousands of salons across time zones needing low latency + regional failover.

- The poster's US-East/US-West model. Keep the API **stateless** (already true) so instances run anywhere;
  **pin each tenant's data to a home region** (tenant → region routing) to keep it simple and compliant.
- Add geo-routing (latency-based DNS / edge) in front, with per-region DB + cache.
- **Design for it now, deploy it late:** the tenant-pinned model above is the only architectural
  pre-requisite, and you already satisfy the hard part (stateless app, tenant-scoped data).

---

## What NOT to do (common premature-scaling traps)

- **Don't shard writes early.** It's the most expensive step and the last one your load shape needs.
- **Don't go multi-region for resilience alone** — a single region with replicas + backups + failover is
  far simpler and sufficient for a very long time.
- **Don't build a big-data/streaming pipeline** until dashboards on the replica + cache actually strain.
  Your audit logs + AI reports already cover today's analytics needs.
- **Don't cache without `tenant_id` in the key.** A cross-tenant cache hit is a data breach, not a bug.

---

## Suggested first three tickets (when you're ready to execute)

1. **Introduce PgBouncer** (infra) + point `DATABASE_URL` at it; document the transaction-mode caveats.
2. **Add `DATABASE_READ` seam** + `DATABASE_REPLICA_URL` (falls back to primary); route overview/reports/
   oversight reads to it. Ships safely with no replica configured (falls back), so it's a no-risk merge.
3. **Profile the four hot read paths** with `EXPLAIN (ANALYZE, BUFFERS)` on a large synthetic tenant;
   add/adjust composite `(tenant_id, …)` indexes where the plan shows sequential scans.

All three are additive, reversible, and don't touch tenant isolation or the domain code.
