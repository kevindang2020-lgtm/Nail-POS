-- audit_events_partition.sql — DELIBERATE maintenance operation (runbook §8). NOT in db/migrations/, so the normal
-- migrate runner NEVER applies it automatically. Converts the append-only audit_events table into a RANGE-partitioned
-- table (monthly, by occurred_at) so old data can be pruned/detached and time-bounded queries hit a single partition.
--
-- ⚠ RUN DURING A MAINTENANCE WINDOW. It renames + recreates audit_events and backfills every row; backfill time and
--   lock duration scale with row count. For very large tables (>10M rows) backfill in batches instead of one INSERT.
--   Writers should be paused (or briefly tolerate the swap) while this runs. It runs in ONE transaction so a failure
--   rolls back cleanly, leaving the original table intact.
--
-- After verifying the new table's counts match, drop the legacy copy (last line, commented out).
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/api/db/maintenance/audit_events_partition.sql
--
-- Note: the partition key must be part of the primary key, so the PK becomes (id, occurred_at). Other audit tables
-- reference events by a TEXT event_ref (not a FK to audit_events.id), so this is safe.

BEGIN;

-- Guard: if already partitioned, do nothing further (safe to re-run).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_partitioned_table pt JOIN pg_class c ON c.oid = pt.partrelid WHERE c.relname = 'audit_events') THEN
    RAISE EXCEPTION 'audit_events is already partitioned — nothing to do (rollback).';
  END IF;
END $$;

-- 1. Set the current table aside (indexes renamed so the new table can reuse the canonical names).
ALTER TABLE audit_events RENAME TO audit_events_legacy;
ALTER INDEX IF EXISTS idx_audit_events_tenant_occurred RENAME TO idx_audit_events_legacy_tenant_occurred;
ALTER INDEX IF EXISTS idx_audit_events_tenant_module   RENAME TO idx_audit_events_legacy_tenant_module;
ALTER INDEX IF EXISTS idx_audit_events_tenant_severity RENAME TO idx_audit_events_legacy_tenant_severity;
ALTER INDEX IF EXISTS idx_audit_events_tenant_actor    RENAME TO idx_audit_events_legacy_tenant_actor;
ALTER INDEX IF EXISTS idx_audit_events_occurred        RENAME TO idx_audit_events_legacy_occurred;
ALTER INDEX IF EXISTS idx_audit_events_module_occurred RENAME TO idx_audit_events_legacy_module_occurred;

-- 2. New partitioned table (same columns/defaults; PK carries the partition key).
CREATE TABLE audit_events (LIKE audit_events_legacy INCLUDING DEFAULTS) PARTITION BY RANGE (occurred_at);
ALTER TABLE audit_events ADD PRIMARY KEY (id, occurred_at);

-- 3. Indexes on the partitioned parent (cascade to every partition).
CREATE INDEX idx_audit_events_tenant_occurred ON audit_events (tenant_id, occurred_at DESC);
CREATE INDEX idx_audit_events_tenant_module   ON audit_events (tenant_id, module);
CREATE INDEX idx_audit_events_tenant_severity ON audit_events (tenant_id, severity);
CREATE INDEX idx_audit_events_tenant_actor    ON audit_events (tenant_id, actor_user_id);
CREATE INDEX idx_audit_events_occurred        ON audit_events (occurred_at DESC);
CREATE INDEX idx_audit_events_module_occurred ON audit_events (module, occurred_at DESC);

-- 4. Monthly partitions spanning the legacy data range, plus a DEFAULT partition so no insert can ever fail.
DO $$
DECLARE d date; mx date;
BEGIN
  SELECT date_trunc('month', min(occurred_at))::date, date_trunc('month', max(occurred_at))::date
    INTO d, mx FROM audit_events_legacy;
  IF d IS NULL THEN d := date_trunc('month', now())::date; mx := d; END IF;
  WHILE d <= mx LOOP
    EXECUTE format('CREATE TABLE IF NOT EXISTS %I PARTITION OF audit_events FOR VALUES FROM (%L) TO (%L)',
      'audit_events_' || to_char(d, 'YYYY_MM'), d, (d + interval '1 month')::date);
    d := (d + interval '1 month')::date;
  END LOOP;
END $$;
CREATE TABLE IF NOT EXISTS audit_events_default PARTITION OF audit_events DEFAULT;

-- 5. Backfill (routes each row to its month's partition, else the default).
INSERT INTO audit_events SELECT * FROM audit_events_legacy;

COMMIT;

-- 6. After verifying counts match, drop the legacy copy:
--    SELECT (SELECT count(*) FROM audit_events) AS new, (SELECT count(*) FROM audit_events_legacy) AS legacy;
--    DROP TABLE audit_events_legacy;
