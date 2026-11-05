# DB_ENTERPRISE_VERIFICATION_REPORT.md
### §25 of the enterprise-DB spec — the final verification, every claim sourced (Jul 30 2026)
Verification basis, all run THIS date on the current tree: **battery 6,091 passed + 4 skipped, 0 failed**
(8 shards, summed from logs) · **14/14 gates** · **432/432 migrations** on PGlite/PG16 · live-catalog
introspection (the generators). Where something cannot be verified without production, it says so.

## 1. Schema audit
**618 tables · 218 explicit FKs · 1,825 indexes · 474 tables tenant-scoped** — introspected, not grepped
(DB_ERD_AND_DOMAINS.md, regenerable). Table count equals the 618 typed Kysely interfaces exactly, enforced
continuously by the `check:types-drift` gate. The 144 non-tenant tables are the global/platform layer (users,
global tech profiles, platform settings, plans, A2P, …) — by design, per the identity model.

## 2. Table inventory · 3. Index inventory · 4. FK review
Generated inventories: DB_ERD_AND_DOMAINS.md (per-domain map + full 618-row table) and DB_INDEX_AUDIT.md.
Index findings: **1 exact duplicate found → dropped (migration 432, re-verified)**; **75 prefix-covered
candidates documented REPORT-ONLY** with the production measurement protocol (`pg_stat_user_indexes` → staged
drop → own migration). FK density is deliberately low: integrity on hot paths rides tenant-scoped queries,
partial-unique **policy** constraints (SID dedupe, open-findings dedupe), and the engine-level exclusion
constraint for booking overlap — stated as a design characteristic, with the schema-as-policy examples in
DATABASE_ARCHITECTURE.md §5.

## 5. Performance review · 6. Query optimization
Measured at seeded scale by the Jul-3 program (SCALING_PHASE1_3_*): **4M audit rows + 1M notifications on live
PG16** — found and fixed a 356MB dashboard rollup (statistics targets, mig 296) and a 23GB worst-case filtered
audit scan (composite indexes carrying the sort column, mig 297: 3.0M → 0.38M buffers worst case, 394 → 54
typical). Pagination is capped platform-wide; keyset/cursor pagination in 26 modules; N+1s hunted by the
profiling passes. Hot reads at target scale: tens-to-hundreds of buffers on one tuned primary.

## 7. Security review
scrypt password hashing (bcrypt timing-equalized legacy compare) · MFA secrets encrypted (`mfa-enc.ts`,
AES-GCM, key or scrypt-derived) · HMAC sessions with report-never-throw verification · **no PAN/CVV anywhere**
(tokenization stays on the processor side) · secrets scan clean, zero real `.env` · audit_logs with
before/after snapshots on sensitive actions. Production CORS/TLS/rate-limit values: NOT VERIFIED until a real
origin exists (KNOWN_ISSUES P2).

## 8. Tenant isolation review
Server-derived tenant/branch context (never client-supplied) · 474/618 tables carry `tenant_id` with the
non-tenant remainder enumerated by domain in the ERD doc · `check:tenant` gate green with a reviewed-exceptions
baseline · cross-tenant behavior pinned by `customer-cross-tenant-isolation.pgtest` and the no-cross-tenant-copy
reconciliation rule.

## 9. Backup strategy · 10. Restore strategy
Strategy (DEPLOYMENT.md + spec §44 of the handoff): managed-Postgres daily snapshots + WAL point-in-time
recovery once hosted; migrations-as-code make schema reproducible from zero (`verify-migrations-pglite` proves
it continuously). **HONEST STATUS: no production database exists, so no backup has ever been taken and no
restore has ever been tested. Restore-testing is a launch-checklist item (DEVELOPER_TASKS APS-020 acceptance),
and this report does NOT claim recovery works.**

## 11. Scaling strategy
The Jul-3 program's phased path stands, all seams shipped OFF by default with an ordered turn-on runbook:
PgBouncer → replica read-split → HTTP cache → rate limiting → entitlement cache → async workers → S3 media.
**Sharding: measured NO-GO** (Outcome A — trigger's 10 conditions unmet; write-saturation harness included for
the day it matters). **Multi-region: measured NO-GO** (statelessness audited; single-owner scheduler guard
shipped). **Partitioning: designed, not pre-built** — keys, triggers, and the conversion runbook per family in
DB_PARTITIONING_READINESS.md. Concurrency model verified op-by-op in DB_TRANSACTIONS_AND_CONCURRENCY.md.

## 12. Advisor recommendation — point-by-point
Modular monolith: **is** the current architecture (one API, domain modules, repository pattern, gates enforcing
the seams). PostgreSQL primary: yes, sole source of truth. Redis: optional-by-flag by design (stateless HMAC
sessions need no store; login throttle has a Redis store behind `LOGIN_THROTTLE_STORE=redis`; queues are
DB-backed workers) — adopt when multi-instance measurement says so. S3 object storage: adapter shipped
(Phase 4), off by default. Read replicas: routing shipped (Phase 2), off by default. Partitioning: readiness
doc above. Background workers: 7, env-gated, findings-only for money-adjacent reconciliation.

## 13. Remaining recommendations (the honest to-do)
1. The 75 index candidates → production measurement protocol (DB_INDEX_AUDIT.md).
2. First hosted deploy → take the first real backup and TEST A RESTORE before pilot day (§10 above).
3. Flip the scaling seams per SCALING_TURNON_RUNBOOK.md order, one at a time, verify each.
4. Live-processor callback replay behavior → verify when CommerceHub creds arrive (the one §12-13 NOT VERIFIED).
5. Revisit partitioning triggers yearly against `pg_stat_user_tables` growth.

**Production-ready claim: NOT MADE.** The database *architecture* is verified enterprise-grade at measured
scale; "production ready" additionally requires a production (hosting, backups + tested restore, live creds) —
those are owner-gated items tracked in REMAINING_WORK.md, and this report follows the project's rule of never
converting uncertainty into "working."
