-- 176_product_imports.sql
-- Product import pipeline for the master catalog: upload → stage → validate → review → (approve) import, with an
-- error queue and idempotent retry. Uploaded rows are NEVER written straight to product_master; they are staged and
-- validated first. Tenant/branch/product IDs inside uploaded files are untrusted and never applied. Money is cents.
CREATE TABLE IF NOT EXISTS product_import_jobs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source             TEXT NOT NULL DEFAULT 'csv',       -- csv | xlsx | vendor_feed | api
  filename           TEXT,
  status             TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','validating','ready','processing','imported','partially_imported','failed','cancelled','rolled_back')),
  total_rows         INTEGER NOT NULL DEFAULT 0,
  valid_rows         INTEGER NOT NULL DEFAULT 0,
  invalid_rows       INTEGER NOT NULL DEFAULT 0,
  imported_rows      INTEGER NOT NULL DEFAULT 0,
  failed_rows        INTEGER NOT NULL DEFAULT 0,
  error_summary      TEXT,
  idempotency_key    TEXT,
  created_by_user_id UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at        TIMESTAMPTZ,
  completed_at       TIMESTAMPTZ,
  CHECK (total_rows >= 0 AND valid_rows >= 0 AND invalid_rows >= 0 AND imported_rows >= 0 AND failed_rows >= 0)
);

CREATE TABLE IF NOT EXISTS product_import_errors (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id       UUID NOT NULL REFERENCES product_import_jobs(id) ON DELETE CASCADE,
  row_number   INTEGER,
  error_type   TEXT NOT NULL,          -- missing_barcode | invalid_sku_format | duplicate_sku | missing_category | invalid_price | ...
  product_name TEXT,
  source_file  TEXT,
  detail       TEXT,
  status       TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','retrying','resolved','failed')),
  retryable    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotent re-submission: a repeated import with the same key does not create a second job.
CREATE UNIQUE INDEX IF NOT EXISTS ux_product_import_idem ON product_import_jobs (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_product_import_jobs_status  ON product_import_jobs (status);
CREATE INDEX IF NOT EXISTS ix_product_import_jobs_created ON product_import_jobs (created_at DESC);
CREATE INDEX IF NOT EXISTS ix_product_import_errors_job    ON product_import_errors (job_id);
CREATE INDEX IF NOT EXISTS ix_product_import_errors_status ON product_import_errors (status);
CREATE INDEX IF NOT EXISTS ix_product_import_errors_type   ON product_import_errors (error_type);
