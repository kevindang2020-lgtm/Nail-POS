-- 296_hotpath_statistics_targets.sql — Scaling Roadmap Phase 1.3.
-- Live EXPLAIN (ANALYZE, BUFFERS) profiling on a 200k-customer / 2M-appointment tenant showed the tenant-wide
-- dashboard rollup over a date range doing a ~356MB parallel heap scan instead of using the existing
-- (tenant_id, appt_date, status) index. Root cause was cardinality mis-estimation at the default statistics target,
-- not a missing index. Raising the statistics target on the hot date/tenant columns lets the planner choose the
-- Index Only Scan naturally — measured ~100x less I/O (45,623 -> ~446 buffers), with no query or index change.
--
-- Safe and reversible: statistics targets only affect planning; ANALYZE recomputes stats. No data change, no lock
-- beyond a brief ANALYZE.

ALTER TABLE pos_tech_appointments ALTER COLUMN appt_date SET STATISTICS 500;
ALTER TABLE pos_tech_appointments ALTER COLUMN tenant_id SET STATISTICS 500;
ALTER TABLE customers ALTER COLUMN created_at SET STATISTICS 500;
ALTER TABLE customers ALTER COLUMN tenant_id SET STATISTICS 500;

ANALYZE pos_tech_appointments;
ANALYZE customers;
