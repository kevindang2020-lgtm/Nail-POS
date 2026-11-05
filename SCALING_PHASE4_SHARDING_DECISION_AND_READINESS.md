# Scaling Phase 4 — Write scaling / tenant sharding: measured decision + readiness (2026-07-03)

The Phase 4 spec is explicit that sharding is likely never necessary and must NOT be pre-built. I inspected the
architecture, measured real table/write data against a seeded dataset, and reached the spec's Outcome A: **sharding is
NOT REQUIRED.** No production shards were built. Instead I delivered the go/no-go decision, a runnable write-saturation
measurement harness, and a sharding-readiness audit — the highest-value work that removes future blockers without
premature complexity.

## FINAL SHARDING DECISION: NOT REQUIRED

The trigger requires **10 conditions, all measurement-based**, ending in "measurements prove writes are the
bottleneck." The app is **not deployed to production**, so there is zero write-saturation data, and the prerequisite
Phases 1-3 (PgBouncer, replica, cache, CDN, rate limiting, worker queues) are code-complete but not yet turned on.
The trigger is definitively unmet. Building sharding now would violate the spec's own Part 45 ("Do not pre-build
unnecessary production sharding").

### Decision table (from the measurement harness on a seeded 200k-tenant / 4M-row dataset)
| Requirement | Current result | Threshold | Pass/Fail | Evidence |
|---|---|---|---|---|
| Primary write CPU | no prod data | infra SLO | N/A | not deployed |
| Write p95 latency | no prod data | infra SLO | N/A | needs pg_stat_statements in prod |
| WAL generation | measurable (harness reads pg_stat_wal) | platform limit | N/A | harness §5 |
| Lock wait | 0 waiters observed | approved p95 | Pass (seed) | harness §6 |
| Buffer cache hit | **98.82%** | high = read-offloaded | Pass | harness §4 |
| Read load offloaded | code ready (replica seam, cache) | required | Ready, not on | Phase 1-2 |
| Cache enabled | code ready (`CACHE_STORE=redis`) | required | Ready, not on | Phase 3 |
| Noisy neighbors isolated | per-tenant rate limiter built | required | Ready, not on | Phase 3 |

**Conclusion:** there is no evidence — and cannot be, pre-deployment — that writes are the bottleneck. The lower-cost
levers (replica, cache, rate limiting) aren't even switched on yet. Sharding is not justified.

## Sharding-readiness audit — the codebase is in good shape, blockers are largely absent

| Blocker (spec) | Finding | Status |
|---|---|---|
| Direct DB bypasses (Part 12/45) | Only 2 `new Pool` sites, both in `*.pgtest.ts` local test harnesses. All production access goes through the `DATABASE`/`DATABASE_READ` seam. | ✅ clean |
| Global ID strategy (Part 10) | 540 tables use UUID/text PKs (`gen_random_uuid`); app generates IDs via `randomUUID`/`gen_random_uuid` (162 sites). UUIDs don't collide across shards. Only 2 `BIGSERIAL` PKs, both tenant-scoped operational tables never used as cross-shard references. | ✅ shard-safe |
| Cross-tenant fan-out (Part 8) | Super Admin already reads **precomputed snapshot tables** (overview_monthly, pos_kpi_daily, utilization, membership_kpi, billing_kpi, queue_metrics, campaign_metric, status_health — 11+). No synchronous all-tenant fan-out on page load. | ✅ largely mitigated |
| Tenant identity (Part 3/40) | Server-derived from session `req.ctx`, never client-supplied. Every query is tenant-filtered in SQL (defense in depth, not shard-isolation-only). | ✅ correct |
| Tenant-to-shard routing seam | `DATABASE`/`DATABASE_READ` tokens already centralize routing; a `TENANT_DATABASE_ROUTER` can wrap them later without touching call sites. | ✅ ready |

The app was architected tenant-first, so the expensive sharding prerequisites (UUID IDs, centralized DB seam, explicit
tenant scoping, precomputed cross-tenant summaries) are already satisfied. If the trigger ever fires, sharding can be
added without a rewrite — which is exactly the readiness goal.

## Table-growth analysis (measured on the seeded dataset)
| Table | Class | Size | Rows | Append-only? | Recommended action |
|---|---|---|---|---|---|
| `pos_tech_appointments` | tenant | 1373 MB | 4.0M | No (transactional source of truth) | Keep on primary; do NOT partition/move casually (spec §33/37). Already indexed (Phase 1.3). |
| `audit_events` | tenant | 1212 MB | 4.0M | **Yes** | Interim **partition candidate** by `occurred_at` (monthly) — WHEN write pressure appears. Retention service already exists. |
| `notifications` | tenant | 221 MB | 1.0M | **Yes** | Interim partition candidate by date — lower priority (lean, 2 indexes). |
| `customers` | tenant | 258 MB | 400k | No | Keep; paginated + indexed. |

## Interim lever assessment (Outcome B) — designed, deliberately NOT executed yet
The genuine interim lever is **time-based partitioning of `audit_events`** (§28-31). I did NOT execute it, on purpose:
converting a live 1.2GB table to partitioned is a heavy table-rewrite migration, and the spec (§29/§36) says optimize
only after measurement. Pre-deployment, there is no write pressure to relieve — partitioning now would itself be the
premature optimization the phase warns against. The design is ready to apply when Stage-1 measurement shows audit
write/vacuum pressure:
| Table | Partition key | Interval | Local indexes | Retention | Rollback |
|---|---|---|---|---|---|
| `audit_events` | `occurred_at` | monthly | `(tenant_id, occurred_at DESC)`, `(tenant_id, module, occurred_at DESC)` (already exist, migration 297) | existing retention service defines eligibility | detach + reattach; expand-and-contract via a new partitioned table + backfill, never in place |

Note: retention *policy* already exists (`audit-retention.service.ts`, `retention-core.ts`); partitioning would make
purges O(drop partition) instead of O(delete scan) — a real future win, gated on measured need.

## What THIS ticket built
**`apps/api/scripts/write-saturation-report.sh`** — a runnable, read-only Stage-1 measurement harness. Against a
production `DATABASE_URL` it prints: largest tables, highest-write tables (ins/upd/del + HOT-update ratio + dead
tuples), DB-wide write vs read work, buffer cache hit ratio, WAL generation, current lock waits, and (when
`pg_stat_statements` is enabled) top write statements by total time — then decision guidance that distinguishes a write
problem from a read/index problem or a noisy-neighbor problem. **Verified running** against the seeded 4M-row dataset:
it correctly reported 98.82% cache hit, WAL bytes, zero lock waits, and gracefully handled `pg_stat_statements` absent.

## Verification
- Harness executes end-to-end against real Postgres 16 with the seeded 200k-tenant / 4M-row dataset (all 7 sections).
- No application code changed → existing api suite unaffected (2598/2598 as of the prior ticket). This phase adds a
  standalone ops script + this decision doc; it introduces no runtime behavior change and no sharding.

## Files created
- `apps/api/scripts/write-saturation-report.sh` — Stage-1 write-saturation measurement harness.
- `SCALING_PHASE4_SHARDING_DECISION_AND_READINESS.md` — this decision + readiness report.

## Known limitations / what remains (all gated on deployment + measurement)
- Real write-latency / WAL-rate / IOPS numbers require a running production primary (and `pg_stat_statements`). The
  harness produces them; the thresholds are the team's infra SLOs.
- `audit_events` partitioning is designed but not executed (gated on measured pressure).
- No shard router / routing DB / migration tooling was built — correctly, per the unmet trigger. If it ever fires, the
  readiness audit above shows the path is clear (UUIDs, centralized seam, precomputed summaries) — no rewrite needed.

## Rollback
Nothing to roll back: no schema change, no routing change, no runtime behavior change. The harness is read-only and
standalone. Sharding remains OFF (it was never built).

## Production-readiness checklist (Phase 4)
- [x] Measured go/no-go decision documented → **NOT REQUIRED**
- [x] System remains on one primary (no shards built)
- [x] DB routing centralized enough for future sharding (DATABASE/DATABASE_READ seam)
- [x] Direct DB bypasses audited (none in production)
- [x] Global-ID strategy shard-safe (UUIDs)
- [x] Cross-tenant fan-out mitigated (precomputed snapshots)
- [x] Highest-write / largest tables measured
- [x] Interim partition candidate identified + designed (not prematurely executed)
- [x] Write-saturation measurement harness delivered + verified
- [x] No unnecessary sharding complexity introduced
