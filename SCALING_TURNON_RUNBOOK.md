# AIPowerSalon — Scaling Turn-On Runbook (work through one phase at a time)

The code is written and tested; every scaling seam ships **off by default**. This runbook is the ordered list of
steps to *turn each one on* in production. Do them **in order** — each is independent, reversible, and has a verify
step. Don't start a phase until the previous one is green.

Legend: **[you]** = an action in your hosting/console. **[me]** = something I can prepare (code, config, script) on
request. **[done]** = already shipped in the tree, just needs to run/flip.

---

## Phase 0 — Ship what's already built (do this first; lowest risk)
These are already in the code; they just need to run in your deploy. Nothing changes behavior until you also flip the
flags in later phases, EXCEPT the migrations, which are pure improvements and safe to apply now.

- [ ] **[you]** Apply the two profiling migrations in your normal migration step: `296_hotpath_statistics_targets.sql`
      and `297_audit_events_composite_indexes.sql`. They're idempotent and safe. Effect: the dashboard rollup and
      filtered audit views get dramatically faster (measured ~100× and ~50× less I/O). *No flags, no downtime.*
      - Production note: `297` builds two indexes — for a large live `audit_events`, build them `CONCURRENTLY`
        (outside a transaction) to avoid a write lock. **[me]** I can hand you a `CONCURRENTLY` variant on request.
- [ ] **Verify:** after deploy, your audit-log filters and dashboard load noticeably faster; no errors in the migration
      step.
- [ ] **Rollback:** drop the two new indexes / reset the statistics targets (both reversible; I can provide the
      down-SQL).

---

## Phase 1 — PgBouncer (connection pooling) — the single biggest lever
**Why first:** connections break before anything else. 10 app instances × 10 pool = 100 connections at idle; Postgres
degrades in the low hundreds. PgBouncer collapses that to a handful.

- [ ] **[you]** Stand up PgBouncer in **transaction** pooling mode in front of your Postgres.
- [ ] **[you]** Point the app's `DATABASE_URL` at PgBouncer instead of directly at Postgres. *(No app code change.)*
- [ ] **[you]** Keep each app instance's own pool small (`PG_POOL_MAX` can stay ~10; PgBouncer does the real
      multiplexing).
- [ ] **Pre-check (important):** transaction mode disables session-level Postgres features (`SET`, session advisory
      locks, `LISTEN/NOTIFY`). You're very likely clear — realtime uses **Redis**, not `LISTEN/NOTIFY`. **[me]** I can
      grep the codebase to confirm zero session-pinned usage before you flip it.
- [ ] **Verify:** active Postgres connections stay low (tens, not hundreds) under load; app behaves identically.
- [ ] **Rollback:** point `DATABASE_URL` back at Postgres directly. Instant.

---

## Phase 2 — Read replica (offload heavy reads)
**Why second:** at 200k customers the *reads* (dashboards, overview boards, catalogs, oversight) swamp the primary
long before writes do. The 5 read-only modules already route to `DATABASE_READ`.

- [ ] **[you]** Provision a read replica of your Postgres.
- [ ] **[you]** Set `DATABASE_REPLICA_URL` to the replica (through PgBouncer too, ideally). When unset, the app safely
      reads from the primary — so this is a pure switch-on.
- [ ] **Safety (already handled):** only pure-read surfaces route to the replica (overview / dashboard / reports /
      super-admin overview + dashboard) — verified zero writes, so replica lag can't cause read-after-write bugs.
      Booking-create / checkout / check-in read-backs stay on the primary.
- [ ] **Verify:** replica receives read traffic; primary write load drops; dashboards/reports still correct.
- [ ] **Rollback:** unset `DATABASE_REPLICA_URL` → all reads fall back to primary. Instant.

---

## Phase 3 — Redis (cache + rate limiting; one Redis, several features)
**Why third:** once reads are split, cache the repeat-heavy aggregates and protect the API from per-tenant floods.

- [ ] **[you]** Provision one Redis instance (managed is fine).
- [ ] **[you]** Set `REDIS_URL` (or the feature-specific `CACHE_REDIS_URL` / `RATE_LIMIT_REDIS_URL`).
- [ ] **[you]** Flip `CACHE_STORE=redis` and `RATE_LIMIT_STORE=redis`.
- [ ] **Safety (already handled):** every cache key embeds `tenant_id` by construction (a cross-tenant hit is
      impossible by design), and both cache and rate-limiter are **fail-open** — if Redis is down, requests still
      succeed (just uncached / unthrottled). Realtime and login-throttle already use this same Redis pattern.
- [ ] **Verify:** dashboard/overview/categories serve from cache on repeat loads; a hammering tenant gets `429 +
      Retry-After`; killing Redis briefly does NOT take the app down (fail-open).
- [ ] **Rollback:** set `CACHE_STORE`/`RATE_LIMIT_STORE` back to their defaults (in-memory/noop). Instant.

---

## Phase 4 — CDN (static bundles + /media/*)
**Why fourth:** cheap win once the dynamic path is handled; the public GETs already send `Cache-Control`.

- [ ] **[you]** Put a CDN in front of the frontend bundles and the `/media/*` path.
- [ ] **[you]** (Optional, later) Swap `MediaStorage` from local-disk to an S3 adapter via env — same interface, same
      keys/URLs. **[me]** I can write the S3 adapter behind the existing port when you're ready.
- [ ] **Verify:** static assets and public salon/tech/branding endpoints serve from the edge with cache headers
      respected; authed routes remain uncached (verified — they deliberately send no cache header).
- [ ] **Rollback:** point DNS back at the origin. Standard CDN rollback.

---

## Phase 5 — Turn on the async import worker (when you need bulk import)
- [ ] **[you]** Set `CUSTOMER_IMPORT_WORKER_ENABLED=true` on at least one API instance (or a dedicated worker
      instance). Approvals then return instantly and imports drain every 15s off the request path.
- [ ] **Verify:** approving a large import returns immediately; rows appear shortly after; or call
      `POST /super-admin/customer-data-oversight/imports/process` to drain on demand.
- [ ] **Rollback:** unset the flag → back to synchronous approve. Instant.

---

## Deferred — do NOT build until measurements demand it
- **Phase 6 — Time-partition `audit_events` / `notifications`** when they reach tens of millions of rows. The
  composite indexes keep them fast until then; the tables are already append-only, so it's a clean seam. **[me]** I can
  write the partitioning migration when the volume warrants it.
- **Phase 7 — Write sharding by `tenant_id`.** Only if one primary's *write* load actually saturates (unlikely for a
  long time). `tenant_id` is the natural shard key; no cross-tenant joins to break.
- **Phase 8 — Multi-region (tenant-pinned).** Only with real geographic spread. The app is already stateless +
  tenant-scoped, so the hard prerequisites are met; deploy it late.

---

## The whole path in one line
Apply the two migrations → PgBouncer → replica → Redis → CDN → (flip the import worker when needed). Everything else is
deferred. Each step is one env/DNS change with an instant rollback, and the code for all of it already exists and is
tested.
