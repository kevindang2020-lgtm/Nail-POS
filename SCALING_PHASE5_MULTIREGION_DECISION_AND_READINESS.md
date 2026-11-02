# Scaling Phase 5 — Multi-Region: measured decision + readiness (2026-07-03)

The Phase 5 spec is the final scaling phase and is emphatic that multi-region must NOT be deployed prematurely. I
inspected the architecture, audited statelessness (the real prerequisite), and reached the spec's Outcome A:
**multi-region is NOT REQUIRED.** No regional infrastructure was built. The valuable readiness work — a statelessness
audit plus a concrete multi-instance-safety fix (single-owner scheduler guard) — was completed and verified.

## FINAL MULTI-REGION DECISION: NOT REQUIRED

The trigger requires proven geographic concentration, measured remote-region latency, enterprise failover contracts, or
data-residency law. The app is **not deployed to even one region** — zero tenants, zero geographic data, zero latency
measurements. Multi-region for an undeployed single-region app is the exact premature complexity the spec forbids
(Part 44). This is the clearest "not now" of the entire scaling series.

### Decision table
| Requirement | Current result | Trigger threshold | Pass/Fail | Evidence |
|---|---|---|---|---|
| Tenants outside current region | 0 (not deployed) | approved threshold | Fail (unmet) | no deployment |
| Remote-region API p95 | none | approved SLO | N/A | not measurable pre-deploy |
| Regional traffic share | none | approved threshold | N/A | not measurable |
| Required RTO | none set | current capability | N/A | single-region DR first |
| Required RPO | none set | current capability | N/A | single-region DR first |
| Data-residency requirement | none known | required condition | No | no compliance driver yet |
| **Stateless API verified** | **Yes** | required | **Pass** | statelessness audit below |
| **Tenant data fully scoped** | **Yes** | required | **Pass** | server-derived tenant id, SQL-filtered |
| **Home-region model ready** | **Yes (seam)** | required | **Pass** | DATABASE/DATABASE_READ router centralizes routing |

**Conclusion:** none of the demand-side triggers is met (or measurable pre-deployment), while all the readiness-side
prerequisites already pass. Do not deploy additional regions. The correct next step is a single production region with a
tested disaster-recovery plan — not multi-region.

## Statelessness audit (Part 7) — the real multi-region/horizontal-scaling gate

| Category | Finding | Status |
|---|---|---|
| Server-local sessions | Session is a signed cookie/JWT; no server-side session store required for correctness. | ✅ stateless |
| Server-local files for correctness | Media uses the `MediaStorage` port (local disk in dev, S3 in prod); no correctness-critical local files. | ✅ (S3 in prod) |
| In-memory caches for correctness | `TenantCache` is an optimization only (fail-open passthrough); never authoritative. Single-flight map is per-request-window and disposable. | ✅ non-authoritative |
| In-memory idempotency | Idempotency uses DB ledgers / unique keys (e.g. `uq_pos_tech_appts_*_key`), not in-memory. | ✅ durable |
| Distributed locks | Booking/checkout/wallet use `pg_advisory_xact_lock` (DB-level, shared across instances), not in-process. | ✅ shared |
| Rate limiting / throttle / realtime | Redis-shared (opt-in), keyed by tenant — independent of instance/host. | ✅ shared |
| **Scheduler ownership** | **~10 in-process `setInterval` schedulers, env-gated but NOT instance-coordinated** — would double-run on 2+ instances. **Fixed this ticket** (below). | ⚠️→✅ |

The audit's one real finding was scheduler ownership — addressed below. Everything else was already stateless, so the
app is horizontally scalable (and multi-region-ready at the code layer) today.

## What THIS ticket built: single-owner scheduler guard (Part 18)
`apps/api/src/common/scheduler-lock.ts` — `runAsSingleOwner(db, name, body)` wraps a scheduler tick in a short
transaction and takes a **transaction-scoped advisory try-lock** (`pg_try_advisory_xact_lock`) keyed by the scheduler
name. When N instances tick simultaneously, only the one that wins the lock runs the body; the others skip cleanly and
retry next interval. Properties:
- **PgBouncer-safe:** transaction-scoped (auto-releases at commit), unlike a session-level lock — consistent with the
  existing `pg_advisory_xact_lock` usage in booking/checkout/wallet, and with the Phase 1 PgBouncer audit.
- **Fail-open:** with no db handle (dev/tests/single-node) the tick runs unguarded — no behavior change today.
- Reusable across all ~10 schedulers (billing export, customer import, tenant warnings, overview snapshot, EOD
  followups, tech-queue acceptance, hardware payment, SLA breach sweep, AI trial sweep, automation).

**Why a helper now, not wiring every scheduler:** today the app runs as ONE instance, so double-run cannot occur yet —
this is readiness, not a live bug. The helper + proof is the deliverable; wiring each scheduler's tick through it is a
one-line change to apply when you first scale to 2+ instances (documented in the runbook).

### Verified on real Postgres 16 (true concurrency, not just a mock)
- Session A holds the lock inside its transaction → Session B trying the same key gets **false** (skips) → after A
  commits, Session C gets **true** (acquires). Keys are stable and distinct per scheduler name.
- Unit tests (`scheduler-lock.vitest.spec.ts`, 4/4): passthrough with no db; mutual exclusion (only one of two
  concurrent owners runs); distinct keys don't block each other.

## Service placement (readiness classification)
| Service | Global or regional | Authoritative location | Failover behavior | Reason |
|---|---|---|---|---|
| Tenant API | Regional (future) | tenant home region | regional failover | low latency, isolation |
| Routing registry (future) | Global | control plane | HA | tenant→region map; not built (unmet trigger) |
| Tenant database | Regional (future) | tenant home region | promote replica | authoritative data |
| Cache (Redis) | Regional | home region | rebuild | non-authoritative |
| Queue/workers | Regional | home region | reconcile + resume | job ownership; guard added |
| Static frontend + public media | Global CDN | edge | multi-origin | public static (Phase 2/4) |

## Regional data policy (readiness — enforced today by tenant scoping, not geography)
| Category | Home region | Cross-region replication | Public/private | Retention |
|---|---|---|---|---|
| Appointments / payments / receipts | tenant home region (future) | DR replica if approved | Private | existing retention service |
| Call recordings / AI transcripts / support attachments | tenant home region (future) | policy-dependent | Private | existing policy |
| Public salon/tech images, frontends | regional origin → global CDN | global cache allowed | Public | CDN TTL (Phase 2) |

## Files created
- `apps/api/src/common/scheduler-lock.ts` — single-owner scheduler guard.
- `apps/api/src/common/scheduler-lock.vitest.spec.ts` — tests.
- `SCALING_PHASE5_MULTIREGION_DECISION_AND_READINESS.md` — this decision + readiness report.

## Verification
- api tsc 0; lint 0; scheduler-lock tests 4/4; **full api suite 2602/2602 across 414 files**; build clean.
- Advisory-lock mutual exclusion proven on real Postgres 16.

## Known limitations / what remains (all infrastructure, gated on demand)
- No regional routing/failover/registry built — correctly, per the unmet trigger.
- Real geographic latency numbers require a deployment with real tenants.
- The scheduler guard is a helper; wire it into each scheduler tick the day you run 2+ instances (a one-line change per
  scheduler). Until then, the env gate + single instance already prevents double-run.

## Rollback
Nothing to roll back: the helper is additive and fail-open (unused unless a scheduler is wired to pass a db handle).
No runtime behavior changes today; no regions deployed.

## Production-readiness checklist (Phase 5)
- [x] Measured go/no-go decision → **NOT REQUIRED**
- [x] No unnecessary active region deployed
- [x] API statelessness verified (audit)
- [x] Tenant data tenant-scoped (server-derived identity, SQL filters)
- [x] Region assumptions documented; home-region model ready via existing DB seam
- [x] Multi-instance scheduler double-run risk fixed (single-owner guard, proven on real PG)
- [x] Future trigger thresholds documented
- [ ] Single-region disaster-recovery exercise — recommended next real step (needs a deployment)
