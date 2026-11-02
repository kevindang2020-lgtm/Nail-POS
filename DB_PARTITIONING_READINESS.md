# DB_PARTITIONING_READINESS.md
### §8 of the enterprise-DB spec: partition design for the large-growth tables — DESIGN ONLY, deliberately not pre-built
Policy inherited from the scaling program (and its measured sharding/multi-region NO-GOs): partitioning ships
when volume warrants it, not before. At the profiled **4M-row scale, composite indexes already serve every hot
read in tens-to-hundreds of buffers** (SCALING_PHASE1_3_GROWTH_TABLES.md — measured, not estimated). Every
table below is kept **append-only / immutable-history** so conversion is a clean seam, not a rewrite.

## Per-family design (key · trigger · mechanics)
| Family | Partition key | Convert when | Mechanics |
| --- | --- | --- | --- |
| `audit_events` (fastest grower) | RANGE monthly on `occurred_at` | tens of millions of rows OR audit views degrade despite mig-297 composites | Native declarative partitioning; existing composites become per-partition local indexes automatically; old months `DETACH … CONCURRENTLY` → export/cold storage |
| `notifications` | RANGE monthly on `created_at` | same order of magnitude; watch the failed-retry view | Same pattern; add `(tenant_id, status, created_at DESC)` composite first if the retry view heats up (already designed in the profiling doc) |
| `sms_usage_records` | RANGE monthly on `created_at` | multi-tenant live SMS at volume | Preserve the SID partial-unique per partition (it is policy, not perf); reconciliation reads are month-bounded already |
| `pos_tech_appointments` | RANGE monthly on the appointment date | tens of millions (≈ years of full production) | Booking reads are date-bounded by nature; the no-overlap EXCLUDE constraint is per-partition safe because holds never span months — verify that invariant in the conversion test |
| `payments` (+ lines/refunds) | RANGE monthly on `created_at` | only with measured write/read pressure | Financial reports are period-bounded; settlements/chargebacks reference by id — keep FKs within-partition-agnostic (reference the logical table) |
| `kpi-snapshot / reporting rollups` | Usually NOT partitioned — they are already the compaction layer | — | Prefer retention windows + summary tables over partitioning here |

## Conversion runbook shape (same for every family)
1. Prove the trigger with production numbers (`pg_stat_user_tables`, slow-query log) — attach them to the PR.
2. Create the partitioned parent + current-month and next-month partitions; backfill history month-by-month
   with `INSERT … SELECT` in batches (or logical replication for zero-downtime), then swap names in one tx.
3. Recreate indexes per partition `CONCURRENTLY`; verify constraint behavior (especially 372's exclusion) with
   the existing race pgtest pointed at the converted table.
4. Automate month rollforward (a tiny worker tick or pg_partman if adopted — a decision for then, not now).
5. Battery + gates green before/after, like any schema change; `verify-migrations-pglite` must still pass for
   fresh installs (write the conversion as migrations, never manual DDL).

## Why not now (one paragraph, so nobody relitigates)
Zero production tenants → zero volume data. The measured profile shows a single tuned PG16 comfortably serving
the target scale's read paths. Partitioning today would add operational surface (partition maintenance, local-
index management) with no measured benefit — the same premature-complexity trap the sharding and multi-region
decisions explicitly rejected. The seam is prepared; the trigger numbers are written; the runbook exists.
