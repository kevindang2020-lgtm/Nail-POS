-- 543_actor_stamp_columns.sql — Constitution 1 §34 / §37 / §55: who last changed a row, and who soft-deleted it.
--
-- 1. `updated_by uuid` on every TENANT table (has tenant_id) that tracks updates (has updated_at) and lacks it.
-- 2. `deleted_by uuid` beside every `deleted_at` (8 tables had deleted_at, none had deleted_by).
-- 3. `created_by uuid` on pos_tech_appointments and pos_queue_items (the two POS work tables with no creator).
-- 4. data_retention_purge_runs gains the columns the central retention executor records (table, action, held, error…).
--
-- The values are written by the Kysely actor-stamp plugin (packages/database/src/actor-stamp.plugin.ts) from the request's
-- actor; a worker / system principal stamps NULL (the audit row names the worker). The columns are deliberately NOT
-- foreign keys: the actor may be a staff user, a technician or a customer (three identity tables), and a stamp must never
-- make a write fail. Nullable, no default: ADD COLUMN is a catalog-only change (no table rewrite) on PG 11+.
-- Idempotent: every ADD is IF NOT EXISTS and the loops skip tables that already have the column.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.table_name
      FROM information_schema.columns c
      JOIN pg_tables t ON t.schemaname = 'public' AND t.tablename = c.table_name
     WHERE c.table_schema = 'public' AND c.column_name = 'updated_at'
       AND EXISTS (SELECT 1 FROM information_schema.columns x WHERE x.table_schema = 'public' AND x.table_name = c.table_name AND x.column_name = 'tenant_id')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns x WHERE x.table_schema = 'public' AND x.table_name = c.table_name AND x.column_name = 'updated_by')
     ORDER BY c.table_name
  LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS updated_by uuid', r.table_name);
  END LOOP;

  FOR r IN
    SELECT c.table_name
      FROM information_schema.columns c
      JOIN pg_tables t ON t.schemaname = 'public' AND t.tablename = c.table_name
     WHERE c.table_schema = 'public' AND c.column_name = 'deleted_at'
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns x WHERE x.table_schema = 'public' AND x.table_name = c.table_name AND x.column_name = 'deleted_by')
     ORDER BY c.table_name
  LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS deleted_by uuid', r.table_name);
  END LOOP;
END $$;

ALTER TABLE pos_tech_appointments ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE pos_queue_items       ADD COLUMN IF NOT EXISTS created_by uuid;

-- The executor's run ledger: one row per table per executed run (dry runs write nothing).
ALTER TABLE data_retention_purge_runs ADD COLUMN IF NOT EXISTS table_name   text;
ALTER TABLE data_retention_purge_runs ADD COLUMN IF NOT EXISTS action       text;
ALTER TABLE data_retention_purge_runs ADD COLUMN IF NOT EXISTS held_count   integer NOT NULL DEFAULT 0;
ALTER TABLE data_retention_purge_runs ADD COLUMN IF NOT EXISTS batches      integer NOT NULL DEFAULT 0;
ALTER TABLE data_retention_purge_runs ADD COLUMN IF NOT EXISTS duration_ms  integer;
ALTER TABLE data_retention_purge_runs ADD COLUMN IF NOT EXISTS triggered_by text;      -- 'job' | 'manual'
ALTER TABLE data_retention_purge_runs ADD COLUMN IF NOT EXISTS error        text;      -- a short message, never row contents
CREATE INDEX IF NOT EXISTS idx_data_retention_purge_runs_table ON data_retention_purge_runs (table_name, occurred_at DESC) WHERE table_name IS NOT NULL;
