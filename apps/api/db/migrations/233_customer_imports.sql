-- 173_customer_imports.sql
-- Customer Data Oversight — Imports. A two-table staging + approval pipeline so bulk customer imports are reviewed
-- before any record is written, and retried idempotently. Strictly tenant-scoped.
--   customer_import_jobs  — one row per uploaded batch; carries lifecycle status + reconciled counts.
--   customer_import_rows  — staged source rows; each validated, then imported / failed, with a per-row dedup key so
--                           a retry never double-imports a row that already succeeded.
CREATE TABLE IF NOT EXISTS customer_import_jobs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL,
  branch_id          uuid,
  source             text NOT NULL DEFAULT 'csv',          -- csv | api | manual
  filename           text,
  status             text NOT NULL DEFAULT 'pending',      -- pending | approved | processing | completed | failed | rejected
  total_rows         integer NOT NULL DEFAULT 0,
  valid_rows         integer NOT NULL DEFAULT 0,
  invalid_rows       integer NOT NULL DEFAULT 0,
  imported_rows      integer NOT NULL DEFAULT 0,
  failed_rows        integer NOT NULL DEFAULT 0,
  requested_by_user_id uuid,
  approved_by_user_id  uuid,
  reject_reason      text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  approved_at        timestamptz,
  completed_at       timestamptz,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS customer_import_rows (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id        uuid NOT NULL REFERENCES customer_import_jobs(id) ON DELETE CASCADE,
  tenant_id     uuid NOT NULL,
  row_number    integer NOT NULL,
  raw_json      jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedup_key     text NOT NULL,                              -- tenant-scoped natural key (e.g. normalized phone/email)
  status        text NOT NULL DEFAULT 'valid',             -- valid | invalid | imported | failed
  error         text,
  customer_id   uuid,                                       -- set when the row is imported into customers
  attempts      integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS customer_import_jobs_tenant_idx   ON customer_import_jobs (tenant_id);
CREATE INDEX IF NOT EXISTS customer_import_jobs_status_idx   ON customer_import_jobs (status);
CREATE INDEX IF NOT EXISTS customer_import_rows_job_idx      ON customer_import_rows (job_id);
CREATE INDEX IF NOT EXISTS customer_import_rows_status_idx   ON customer_import_rows (status);
-- Idempotency: within one job a given dedup key is staged at most once, so a retry cannot duplicate it.
CREATE UNIQUE INDEX IF NOT EXISTS customer_import_rows_job_dedup_uq
  ON customer_import_rows (job_id, dedup_key);
