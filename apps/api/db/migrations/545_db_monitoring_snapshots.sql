-- 545_db_monitoring_snapshots.sql — BUILD_PLAN Phase 10 (Constitution 1 §94–97, §111 "database monitoring exists",
-- "slow queries are observable").
--
-- Two platform-global monitoring tables the Super Admin Database page reads (System Operations → Database).
--
--   db_table_size_snapshots — one row per table per UTC day, written by the `database.size_snapshot` job (runTick,
--     every 6 h; upsert on (snapshot_date, table_name), so the last run of the day wins). The page draws a 90-day
--     growth series per table from it; PostgreSQL itself keeps no history of table size. Rows older than 400 days are
--     purged by the same job.
--
--   db_slow_query_samples — durable slow-query SHAPES. `pg_stat_statements` is not installed on every target (it needs
--     shared_preload_libraries; the local PostgreSQL and the managed tiers we use do not preload it), and the app's own
--     slow-query telemetry (@aipowersalon/observability db-telemetry: shapes over DB_SLOW_QUERY_MS, default 250 ms) lives
--     in a bounded in-process table that is lost on every restart and is per process. Each process flushes its new
--     samples here (`database.slow_query_flush`, every 5 min). What is stored is the FINGERPRINT — compiled SQL with every
--     parameter replaced by `$?` and long literals by N — never parameter values (§95, Constitution 11 §367).
--     `tenant_id` is the request's tenant when there was one (§95 "tenant_id where safe"); it is a filter, not ownership:
--     this is platform data (ownership E). Rows older than 30 days are purged by the flush.
CREATE TABLE IF NOT EXISTS db_table_size_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date date NOT NULL,
  taken_at timestamptz NOT NULL DEFAULT now(),
  table_name text NOT NULL,
  total_bytes bigint NOT NULL DEFAULT 0 CHECK (total_bytes >= 0),
  table_bytes bigint NOT NULL DEFAULT 0 CHECK (table_bytes >= 0),
  index_bytes bigint NOT NULL DEFAULT 0 CHECK (index_bytes >= 0),
  row_estimate bigint NOT NULL DEFAULT 0,
  dead_tuples bigint NOT NULL DEFAULT 0,
  seq_scans bigint NOT NULL DEFAULT 0,
  idx_scans bigint NOT NULL DEFAULT 0,
  CONSTRAINT uq_db_table_size_snapshots_day UNIQUE (snapshot_date, table_name)
);
CREATE INDEX IF NOT EXISTS idx_db_table_size_snapshots_table_day ON db_table_size_snapshots (table_name, snapshot_date DESC);

CREATE TABLE IF NOT EXISTS db_slow_query_samples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sampled_at timestamptz NOT NULL,
  query_hash text NOT NULL CHECK (query_hash ~ '^[0-9a-f]{6,64}$'),
  fingerprint text NOT NULL CHECK (length(fingerprint) <= 500),
  operation text NOT NULL,
  table_name text NOT NULL,
  duration_ms integer NOT NULL CHECK (duration_ms >= 0),
  row_count integer NOT NULL DEFAULT 0,
  request_id text,
  tenant_id uuid,
  process_role text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_db_slow_query_samples_sampled ON db_slow_query_samples (sampled_at DESC);
CREATE INDEX IF NOT EXISTS idx_db_slow_query_samples_hash ON db_slow_query_samples (query_hash, sampled_at DESC);
CREATE INDEX IF NOT EXISTS idx_db_slow_query_samples_tenant ON db_slow_query_samples (tenant_id, sampled_at DESC) WHERE tenant_id IS NOT NULL;
