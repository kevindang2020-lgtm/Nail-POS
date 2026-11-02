-- 185_integration_sync.sql — synchronization engine substrate for integration connections.
-- Three tables, nothing existing changed:
--   • integration_sync_jobs      — one row per sync attempt (queued→running→successful|partial|failed|dead), with
--                                   sync type, cursor before/after, item counts, idempotency key, retry_count, the
--                                   provider record ids that failed (for targeted retry), and a correlation id.
--   • integration_sync_cursors   — the resume point per (connection, sync_type); advanced ONLY on safe completion.
--   • integration_sync_records   — the idempotency ledger. UNIQUE (connection_id, provider_record_id) guarantees a
--                                   provider record is applied at most once per connection, so re-running a sync
--                                   never duplicates downstream effects. The ledger is per-connection (hence per
--                                   tenant), so the same provider record id under two tenants never collides.

CREATE TABLE IF NOT EXISTS integration_sync_jobs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id     UUID NOT NULL,
  tenant_id         UUID,
  branch_id         UUID,
  sync_type         TEXT NOT NULL DEFAULT 'incremental',  -- full|incremental|scheduled|webhook|manual|retry|backfill|validation
  status            TEXT NOT NULL DEFAULT 'queued',       -- queued|running|successful|partial|failed|dead|paused
  cursor_before     TEXT,
  cursor_after      TEXT,
  items_read        INT NOT NULL DEFAULT 0,
  items_created     INT NOT NULL DEFAULT 0,
  items_updated     INT NOT NULL DEFAULT 0,
  items_skipped     INT NOT NULL DEFAULT 0,
  items_failed      INT NOT NULL DEFAULT 0,
  idempotency_key   TEXT,
  retry_count       INT NOT NULL DEFAULT 0,
  max_attempts      INT NOT NULL DEFAULT 5,
  failed_record_ids TEXT[] NOT NULL DEFAULT '{}',
  error_category    TEXT,
  error_message     TEXT,
  correlation_id    UUID,
  next_attempt_at   TIMESTAMPTZ,
  started_at        TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  created_by_user_id UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- de-duplicate enqueues: one job per (connection, type, idempotency key)
CREATE UNIQUE INDEX IF NOT EXISTS uq_sync_job_idem ON integration_sync_jobs (connection_id, sync_type, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_sync_job_conn ON integration_sync_jobs (connection_id, status);
CREATE INDEX IF NOT EXISTS ix_sync_job_status ON integration_sync_jobs (status, next_attempt_at);
CREATE INDEX IF NOT EXISTS ix_sync_job_tenant ON integration_sync_jobs (tenant_id);

CREATE TABLE IF NOT EXISTS integration_sync_cursors (
  connection_id  UUID NOT NULL,
  sync_type      TEXT NOT NULL,
  cursor_value   TEXT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (connection_id, sync_type)
);

CREATE TABLE IF NOT EXISTS integration_sync_records (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id      UUID NOT NULL,
  tenant_id          UUID,
  provider_record_id TEXT NOT NULL,
  last_sync_job_id   UUID,
  action             TEXT NOT NULL DEFAULT 'created',      -- created|updated
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sync_record_ledger ON integration_sync_records (connection_id, provider_record_id);
CREATE INDEX IF NOT EXISTS ix_sync_record_tenant ON integration_sync_records (tenant_id);
