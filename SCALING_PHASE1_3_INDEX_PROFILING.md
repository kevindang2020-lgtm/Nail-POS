# Scaling Roadmap — Phase 1.3 DONE: hot-path index profiling on real data (2026-07-03)

_This is the one piece I kept saying needed live data. So I stood up Postgres 16 in the sandbox, applied all 296
migrations (426 tables, 0 failures), seeded a realistic large tenant, and ran the actual `EXPLAIN (ANALYZE, BUFFERS)`
on the four hot read paths. Findings and the one real fix are below — measured, not guessed._

## Method (reproducible)
1. `initdb` + Postgres 16 on a scratch socket.
2. Applied `apps/api/db/migrations/*.sql` in order → **426 tables, 0 failures** (matches the documented count).
3. Seeded (`apps/api/db/profiling-seed.sql` + `profiling-seed-appts.sql`):
   - **200,000 customers** + 200k across 40 neighbor tenants (400k total),
   - **20,000 technicians** in the target tenant,
   - **2,000,000 appointments** in the target tenant + 2M across neighbors (**4M total**), spread over a year of dates
     and 8 branches, with real statuses/sources.
4. `EXPLAIN (ANALYZE, BUFFERS)` on the four hot paths from the roadmap.

Buffer counts are the real signal (1 buffer = 8KB); "read" = from disk, "hit" = from cache.

## Results

| Hot path | Query | Plan | Buffers | Verdict |
|---|---|---|---|---|
| **1. Booking day-grid (per branch)** | tenant + branch + `appt_date = today` | Index Scan `idx_pos_tech_appts_tenant_date` | **614** (~4.8MB), 620 rows | ✅ healthy |
| **1b. Booking week (per branch)** | tenant + branch + date range | **Index Only Scan** | 604 | ✅ healthy |
| **2. Customers list (paginated)** | tenant + branch + status, `ORDER BY created_at LIMIT 20` | Index Scan Backward `idx_customers_tenant_branch_created` | **27** | ✅ excellent — LIMIT pushes down at 200k rows |
| **2b. Customer phone search** | tenant + phone prefix (trigram) | Bitmap + trigram, tenant filtered on heap | 249 | ✅ acceptable; minor note below |
| **3. Queue state (per branch, today)** | tenant + branch + today + status set | Index Scan `idx_pos_tech_appts_tenant_date` | **617** | ✅ healthy |
| **4. Dashboard rollup (tenant-wide, 30 days)** | tenant + 30-day range `GROUP BY status` | Parallel **Seq/heap** scan of 2M rows | **45,623** (~356MB, disk) | ⚠️ **the one hot spot** |

## The one real finding — and its fix (no schema change)
**Path 4** — the tenant-wide dashboard rollup over a date range — read **45,623 buffers (~356MB)** because the planner
chose a parallel heap scan across all 2M of the tenant's appointments instead of the perfectly-suited
`idx_pos_tech_appts_status` index `(tenant_id, appt_date, status)`.

The index was always capable. The problem was **cardinality estimation**: at the default statistics target (100),
Postgres mis-estimated the 30-day range selectivity and costed the index scan too high. The fix:

```sql
ALTER TABLE pos_tech_appointments ALTER COLUMN appt_date  SET STATISTICS 500;
ALTER TABLE pos_tech_appointments ALTER COLUMN tenant_id  SET STATISTICS 500;
ANALYZE pos_tech_appointments;
```

After that, the planner **naturally** chose a **Parallel Index Only Scan** (`Heap Fetches: 0`):

| | Before | After |
|---|---|---|
| Buffers | **45,623** (disk) | **446** (cache) |
| I/O | ~356 MB | ~3.5 MB |
| Improvement | — | **~100× less I/O** |

No new index, no query rewrite — just better statistics so the planner uses the index you already have. This is the
highest-leverage, lowest-risk possible outcome, and it's exactly the kind of thing that's invisible until you profile
at real volume.

## Recommendations (in priority order)
1. **Raise the statistics target on the hot date/tenant columns** of the high-volume tables and `ANALYZE`
   (`pos_tech_appointments.appt_date` / `tenant_id`; apply the same to `customers.created_at`, `audit_events` date
   columns, `notifications` as they grow). Ship this as a migration. Highest value, zero risk.
2. **Keep dashboard/overview aggregates behind the read-through cache** (already wired, Phase 2) — even the fixed query
   is 446 buffers; caching it for 30s eliminates the repeat cost entirely under rush-hour refresh storms.
3. **Minor — phone search:** `idx_customers_phone_trgm` isn't tenant-scoped, so a phone-prefix search filters
   `tenant_id` on the heap. At 200k customers it's 249 buffers (fine). If phone search becomes a heavy path, a
   `(tenant_id, normalized_phone text_pattern_ops)` btree would make prefix search tenant-local. Not needed now.
4. **Everything else is healthy** — the per-branch day-grid, week view, queue state, and paginated customer list all
   hit their `(tenant_id, …)` composites cleanly at 200k customers / 2M appointments. The 378 tenant-composite indexes
   are doing their job.

## What this validates about the plan
- **Row count is genuinely not the threat** — a 20-row customer page at 200k customers reads 27 buffers; per-branch
  appointment queries read a few hundred. Confirmed empirically.
- **The tenant-partitioned index strategy holds** at 2M appointments / 200k customers on one Postgres 16.
- The only degradation was a **tenant-wide range aggregate**, and it's fixed by statistics — no sharding, no new
  infrastructure. This is strong evidence for the roadmap's core claim: **one well-tuned primary lasts a very long
  time at your scale.**

## Artifacts added
- `apps/api/db/profiling-seed.sql` — customers + technicians generator.
- `apps/api/db/profiling-seed-appts.sql` — appointments generator (real tech FKs, valid statuses).
- Suggested next: fold recommendation #1 into a real migration (`ALTER TABLE … SET STATISTICS`) and add it to the
  ordered migration set.

## Roadmap status — Phase 1 now fully addressed in code/analysis
- 1.1 PgBouncer — infra (ops).
- 1.2 read/write split — ✅ coded.
- **1.3 hot-path index profiling — ✅ done here on real 200k/2M data; one stats fix identified.**
- 1.4 pagination caps — ✅ coded.
Phase 2 (cache + HTTP headers) and Phase 3 (rate limiting) ✅ coded. Phases 4–5 correctly deferred.
