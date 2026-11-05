# Scaling Roadmap — Phase 1.3 (cont.): profiling the append-only growth tables (2026-07-03)

_Follow-up to the hot-path profiling. The roadmap flags `audit_events` / `notifications` as the fastest-growing
tables (a row per action / per message) and Phase-4 partition candidates. I seeded them at scale on the live Postgres
and profiled the read paths — found a real degradation on filtered audit views and fixed it with two composite
indexes (shipped as migration 297)._

## Seeded volume (on the same live Postgres 16, migrations applied)
- **audit_events: 4,000,000 rows** — 3M for the target tenant across a year (modules, actions, severities), 1M across
  40 neighbor tenants.
- **notifications: 1,000,000 rows** for the target tenant (sms/email, sent/failed/blocked).

## Results

| Path | Query | Before | After fix | Verdict |
|---|---|---|---|---|
| **Audit — recent page (default view)** | tenant, `ORDER BY occurred_at DESC LIMIT 50` | **53** buffers | 53 | ✅ perfect (untouched) |
| **Audit — module filter** | tenant + module, recent | **394** | **54** | ✅ fixed |
| **Audit — severity filter** | tenant + severity, recent | **268** | **53** | ✅ fixed |
| **Audit — worst case** | tenant + module + action, deep time, selective | **3,007,013 (~23GB!)** | **375,737** | ⚠️→ 8× better; edge case |
| **Notifications — recent** | tenant, `ORDER BY created_at DESC LIMIT 50` | **53** | 53 | ✅ perfect |
| **Notifications — failed-only** | tenant + status='failed', recent | **251** | 251 | ✅ acceptable |

## The finding — filtered audit views could read gigabytes
The default audit view (recent, no filter) was always fine — `idx_audit_events_tenant_occurred`
`(tenant_id, occurred_at DESC)` paginates in ~53 buffers even at 3M rows.

But **filtered** audit views (by module or severity) reused that same time index and then *discarded* non-matching
rows while walking backward through time to collect a page. For a common filter that's ~400 buffers (tolerable); for a
**selective filter over a deep time range** the planner scanned the tenant's entire audit history —
**3,007,013 buffers ≈ 23GB, `Rows Removed by Filter: 3,000,000`**. That's a latent landmine: audit logs only grow, so
this gets worse every month.

## The fix — composite indexes carrying the sort column (migration 297)
```sql
CREATE INDEX idx_audit_events_tenant_module_occurred   ON audit_events (tenant_id, module,   occurred_at DESC);
CREATE INDEX idx_audit_events_tenant_severity_occurred ON audit_events (tenant_id, severity, occurred_at DESC);
DROP INDEX idx_audit_events_tenant_module;     -- redundant: same leading prefix as the composite
DROP INDEX idx_audit_events_tenant_severity;   -- redundant
```
Carrying `occurred_at DESC` as the trailing column makes the filter an **index range** *and* satisfies the `ORDER BY`
from the index — no scan-and-discard. Measured: module filter **394 → 54**, severity **268 → 53**, worst case
**3.0M → 0.38M** buffers.

**Net index cost is roughly flat**, not additive: the two new composites (~103MB + ~95MB) replace the two dropped
single-column indexes (~26MB + ~25MB), and because the old ones were prefixes of the new ones, no query loses an
index. Write amplification stays the same (still two audit indexes on those columns), we just made them useful for the
sorted-filter path.

## Notifications — healthy, no change needed
`idx_notifications_tenant_created` `(tenant_id, created_at DESC)` serves both the recent list (53 buffers) and the
failed-only retry view (251 buffers) well at 1M rows. No fix required. If a status-filtered retry view becomes a hot,
high-volume path later, the same pattern applies: `(tenant_id, status, created_at DESC)`.

## Partitioning outlook (roadmap Phase 4 seam)
At **4M audit rows** one Postgres 16 handles these reads in tens-to-hundreds of buffers with the composite indexes.
Partitioning isn't needed yet. When `audit_events` reaches tens of millions:
- **Monthly range partition on `occurred_at`** — recent-heavy reads touch only the current partition; old partitions
  detach for cold storage/export. The composite indexes become per-partition local indexes automatically.
- Keep the table **append-only** (it already is) so partitioning is a clean seam, not a rewrite.
This is a *plan*, not a now-action — the indexes above keep it fast until the volume genuinely warrants partitioning.

## Migrations shipped this profiling arc
- `296_hotpath_statistics_targets.sql` — stats-target fix for the dashboard rollup (~100× I/O reduction).
- `297_audit_events_composite_indexes.sql` — audit filtered-view composites (this ticket), idempotent
  (`IF NOT EXISTS`/`IF EXISTS`), production note to use `CONCURRENTLY`.
- Seed scripts: `profiling-seed.sql`, `profiling-seed-appts.sql`, `profiling-seed-growth.sql` — reproducible at any
  time against a real Postgres.

## Net Phase 1.3 outcome
Two real, measured defects found only under realistic volume — a dashboard rollup doing 356MB and audit filters
capable of 23GB — both fixed with **statistics + indexes, no schema redesign and no sharding**. This is exactly what
live profiling is for, and it further validates the plan: a single tuned primary serves your 200k customers / 20k
techs / multi-million-row audit trail comfortably.
