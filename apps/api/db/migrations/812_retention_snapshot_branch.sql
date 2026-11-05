-- 812_retention_snapshot_branch.sql — C3 / C5 gap (Nov 5 2026): per-location retention history. Each daily snapshot row now
-- records the location of the customer's last visit as of that day (and the customer's home location for those who never
-- visited); a run records that it carries the location so a location view never shows a figure for a day computed before
-- this (those days say "location not recorded" instead of a wrong number). Expand-only.
ALTER TABLE customer_retention_daily_snapshots ADD COLUMN IF NOT EXISTS last_visit_branch_id uuid;
ALTER TABLE customer_retention_daily_snapshots ADD COLUMN IF NOT EXISTS home_branch_id uuid;
ALTER TABLE customer_retention_snapshot_runs ADD COLUMN IF NOT EXISTS has_branch boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS customer_retention_daily_snapshots_branch_idx ON customer_retention_daily_snapshots (tenant_id, snapshot_local_date, definition_version, last_visit_branch_id);
