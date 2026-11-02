-- 534_schema_operations_ledgers.sql — BUILD_PLAN Phase 10 (Constitution 1 §69–71, §88, §111 "large migrations are safe",
-- "no dangerous migration remains unresolved").
--
-- Two small platform-global ledgers that the rest of Phase 10 writes to:
--
--   schema_deferred_constraints — a constraint or type change a migration WANTED to add but could not on THIS database
--     because the data does not satisfy it yet (duplicate emails before a unique index, orphan rows before a FK is
--     validated, a text id column holding a non-UUID value). The migration records the fact here instead of failing the
--     deploy, the Super Admin Database page lists the rows, and `scripts/db-validate-constraints.mjs` retries them once
--     the data is fixed. A fresh database (tests, a new environment) records nothing: every constraint applies cleanly.
--
--   schema_backfills — progress of batched, resumable backfills (`runBackfill` in @aipowersalon/database): one row per
--     backfill name with the last key processed, so a backfill interrupted by a deploy resumes where it stopped instead
--     of starting over (and never runs the same batch twice).
CREATE TABLE IF NOT EXISTS schema_deferred_constraints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,                      -- the constraint / index name the migration intended
  table_name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('unique', 'foreign_key_validation', 'check_validation', 'type_change', 'not_null', 'other')),
  migration text NOT NULL,                 -- the migration file that deferred it
  reason text NOT NULL,                    -- what the pre-flight found (counts, never row contents)
  blocking_rows integer,                   -- how many rows stood in the way, when the pre-flight counted them
  retry_sql text,                          -- the exact statement to run once the data is fixed
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,                 -- set by db-validate-constraints.mjs when the retry succeeded
  resolved_by text,                        -- 'db-validate-constraints' | a user id
  UNIQUE (name, table_name)
);
CREATE INDEX IF NOT EXISTS idx_schema_deferred_constraints_open ON schema_deferred_constraints (created_at) WHERE resolved_at IS NULL;

CREATE TABLE IF NOT EXISTS schema_backfills (
  name text PRIMARY KEY,                   -- stable backfill name, e.g. 'loyalty_ledger_from_profiles'
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'paused', 'completed', 'failed')),
  last_key text,                           -- the last primary key (as text) a completed batch covered
  rows_done bigint NOT NULL DEFAULT 0,
  batches_done integer NOT NULL DEFAULT 0,
  batch_size integer NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  last_error text
);

-- A helper every later Phase 10 migration can call from a DO block: record a deferral once (idempotent on re-run).
CREATE OR REPLACE FUNCTION schema_defer_constraint(p_name text, p_table text, p_kind text, p_migration text, p_reason text, p_blocking integer, p_retry_sql text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO schema_deferred_constraints (name, table_name, kind, migration, reason, blocking_rows, retry_sql)
  VALUES (p_name, p_table, p_kind, p_migration, p_reason, p_blocking, p_retry_sql)
  ON CONFLICT (name, table_name) DO UPDATE SET reason = EXCLUDED.reason, blocking_rows = EXCLUDED.blocking_rows, retry_sql = EXCLUDED.retry_sql
    WHERE schema_deferred_constraints.resolved_at IS NULL;
END $$;
