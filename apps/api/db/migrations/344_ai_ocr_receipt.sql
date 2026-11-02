-- 323_ai_ocr_receipt.sql — AI Receipt & Document Recognition data model.
-- Every table is tenant-scoped (tenant_id NOT NULL). Money is integer cents. Full PANs/bank numbers are NEVER stored
-- (only masked last-4 in extracted values / redacted text). Posting is idempotent (unique key below). AI never posts:
-- review + approval rows gate every posting. Reuses existing expenses / inventory (receivePurchaseOrder,
-- saveReceiptExpense) / inventory_vendors / inventory_categories — no second financial or inventory ledger is created here.

-- ── core document ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ocr_documents (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL,
  branch_id              UUID,
  uploaded_by_user_id    UUID,
  source_channel         TEXT NOT NULL DEFAULT 'upload',        -- upload|email|mobile|api
  document_type          TEXT NOT NULL DEFAULT 'unknown',
  classification_confidence NUMERIC(4,3) DEFAULT 0,
  vendor                 TEXT,
  vendor_id              UUID,                                  -- resolved inventory_vendors.id (nullable)
  document_number        TEXT,
  document_date          DATE,
  date_ambiguous         BOOLEAN NOT NULL DEFAULT false,
  currency               TEXT NOT NULL DEFAULT 'USD',
  subtotal_cents         BIGINT,
  tax_cents              BIGINT,
  fees_cents             BIGINT,
  discount_cents         BIGINT,
  total_cents            BIGINT,
  is_credit_or_refund    BOOLEAN NOT NULL DEFAULT false,
  overall_confidence     NUMERIC(4,3) DEFAULT 0,
  pipeline_status        TEXT NOT NULL DEFAULT 'uploaded',      -- uploaded|scanning|extracting|validating|review_required|in_review|approved|posted|rejected|failed|quarantined
  validation_status      TEXT NOT NULL DEFAULT 'pending',       -- pending|valid|needs_review|blocked
  review_status          TEXT NOT NULL DEFAULT 'not_started',   -- not_started|in_progress|submitted|approved|rejected|returned
  posting_status         TEXT NOT NULL DEFAULT 'not_posted',    -- not_posted|posting|posted|failed
  duplicate_status       TEXT NOT NULL DEFAULT 'none',          -- none|possible|likely|exact
  review_priority        TEXT NOT NULL DEFAULT 'normal',        -- low|normal|high
  retention_hold         BOOLEAN NOT NULL DEFAULT false,
  retention_delete_after DATE,
  deleted_at             TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ocr_docs_tenant ON ocr_documents (tenant_id, pipeline_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ocr_docs_review ON ocr_documents (tenant_id, review_status, review_priority);

-- ── files / pages ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ocr_document_files (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL,
  document_id    UUID NOT NULL,
  kind           TEXT NOT NULL DEFAULT 'original',             -- original|processed|thumbnail
  storage_key    TEXT NOT NULL,                                -- tenant-scoped MediaStorage key; NEVER a raw URL
  mime_type      TEXT,
  size_bytes     BIGINT,
  page_count     INT,
  file_hash      TEXT,                                         -- sha256 of bytes (dedup)
  perceptual_hash TEXT,                                        -- image hash (dedup, images only)
  scan_status    TEXT NOT NULL DEFAULT 'pending',              -- pending|clean|infected|unscanned|error
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ocr_files_doc ON ocr_document_files (tenant_id, document_id);
CREATE INDEX IF NOT EXISTS idx_ocr_files_hash ON ocr_document_files (tenant_id, file_hash);

CREATE TABLE IF NOT EXISTS ocr_document_pages (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL,
  document_id    UUID NOT NULL,
  page_number    INT NOT NULL,
  storage_key    TEXT,
  ocr_text_redacted TEXT,                                      -- redacted (no full PAN/bank numbers)
  width          INT,
  height         INT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ocr_pages_doc ON ocr_document_pages (tenant_id, document_id, page_number);

-- ── OCR jobs ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ocr_jobs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL,
  document_id      UUID NOT NULL,
  provider_key     TEXT NOT NULL,
  provider_job_id  TEXT,
  status           TEXT NOT NULL DEFAULT 'queued',             -- queued|running|succeeded|failed|timed_out
  attempt          INT NOT NULL DEFAULT 1,
  error_code       TEXT,
  requested_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at     TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ocr_jobs_provider ON ocr_jobs (tenant_id, provider_key, provider_job_id) WHERE provider_job_id IS NOT NULL;

-- ── extraction ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ocr_extracted_fields (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL,
  document_id    UUID NOT NULL,
  field_key      TEXT NOT NULL,                                -- vendor|document_number|document_date|subtotal|tax|total|...
  value_text     TEXT,                                         -- masked/redacted where sensitive
  value_cents    BIGINT,
  confidence     NUMERIC(4,3) DEFAULT 0,
  state          TEXT NOT NULL DEFAULT 'missing',              -- high|medium|low|missing|conflicting|manually_confirmed|manually_corrected
  source_page    INT,
  corrected_value TEXT,
  corrected_by_user_id UUID,
  corrected_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ocr_fields_doc ON ocr_extracted_fields (tenant_id, document_id);

CREATE TABLE IF NOT EXISTS ocr_line_items (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL,
  document_id    UUID NOT NULL,
  line_number    INT NOT NULL,
  description    TEXT,
  sku            TEXT,
  quantity       NUMERIC(12,3),
  unit           TEXT,
  unit_price_cents BIGINT,
  discount_cents BIGINT,
  tax_cents      BIGINT,
  line_total_cents BIGINT,
  confidence     NUMERIC(4,3) DEFAULT 0,
  reconciles     BOOLEAN,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ocr_lines_doc ON ocr_line_items (tenant_id, document_id, line_number);

-- ── validation / duplicates / matches ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS ocr_validation_results (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL,
  document_id    UUID NOT NULL,
  status         TEXT NOT NULL,                                -- valid|needs_review|blocked
  flags          JSONB NOT NULL DEFAULT '[]',
  blocks_posting BOOLEAN NOT NULL DEFAULT false,
  review_priority TEXT NOT NULL DEFAULT 'normal',
  overall_confidence NUMERIC(4,3) DEFAULT 0,
  missing_fields JSONB NOT NULL DEFAULT '[]',
  checks         JSONB NOT NULL DEFAULT '[]',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ocr_validation_doc ON ocr_validation_results (tenant_id, document_id);

CREATE TABLE IF NOT EXISTS ocr_duplicate_matches (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL,
  document_id    UUID NOT NULL,
  matched_document_id UUID NOT NULL,
  status         TEXT NOT NULL,                                -- exact|likely|possible
  reason         TEXT,
  perceptual_distance INT,
  dismissed      BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ocr_dupes_doc ON ocr_duplicate_matches (tenant_id, document_id);

CREATE TABLE IF NOT EXISTS ocr_vendor_matches (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL,
  document_id    UUID NOT NULL,
  matched_vendor_id UUID,                                      -- inventory_vendors.id
  matched_name   TEXT,
  score          NUMERIC(4,3) DEFAULT 0,
  confirmed      BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ocr_vendor_doc ON ocr_vendor_matches (tenant_id, document_id);

CREATE TABLE IF NOT EXISTS ocr_category_suggestions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL,
  document_id    UUID NOT NULL,
  suggested_category_id UUID,                                  -- inventory_categories.id
  suggested_name TEXT,
  score          NUMERIC(4,3) DEFAULT 0,
  source         TEXT NOT NULL DEFAULT 'deterministic',        -- deterministic|ai
  confirmed      BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ocr_category_doc ON ocr_category_suggestions (tenant_id, document_id);

CREATE TABLE IF NOT EXISTS ocr_inventory_matches (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL,
  document_id    UUID NOT NULL,
  line_item_id   UUID,
  matched_product_id UUID,
  matched_unit_id UUID,
  score          NUMERIC(4,3) DEFAULT 0,
  confirmed      BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ocr_invmatch_doc ON ocr_inventory_matches (tenant_id, document_id);

-- ── review / approval ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ocr_reviews (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL,
  document_id    UUID NOT NULL,
  status         TEXT NOT NULL DEFAULT 'in_progress',          -- in_progress|submitted|approved|rejected|returned
  assigned_user_id UUID,
  started_by_user_id UUID,
  started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at   TIMESTAMPTZ,
  notes          TEXT
);
CREATE INDEX IF NOT EXISTS idx_ocr_reviews_doc ON ocr_reviews (tenant_id, document_id);

CREATE TABLE IF NOT EXISTS ocr_approvals (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL,
  document_id    UUID NOT NULL,
  action         TEXT NOT NULL,                                -- approve|reject|return
  actor_user_id  UUID,
  reason         TEXT,
  before_snapshot JSONB,
  after_snapshot  JSONB,
  version        INT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ocr_approvals_doc ON ocr_approvals (tenant_id, document_id);

-- ── posting (idempotent) ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ocr_postings (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL,
  document_id    UUID NOT NULL,
  destination    TEXT NOT NULL,                                -- expense|inventory_receipt
  posting_version INT NOT NULL DEFAULT 1,
  external_ref   TEXT,                                         -- expenses.id or PO receipt id
  status         TEXT NOT NULL DEFAULT 'pending',              -- pending|posted|failed
  idempotency_key TEXT NOT NULL,
  error_code     TEXT,
  posted_by_user_id UUID,
  posted_at      TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ocr_postings_idem ON ocr_postings (idempotency_key);
CREATE INDEX IF NOT EXISTS idx_ocr_postings_doc ON ocr_postings (tenant_id, document_id);

CREATE TABLE IF NOT EXISTS ocr_posting_attempts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL,
  posting_id     UUID NOT NULL,
  outcome        TEXT NOT NULL,                                -- started|succeeded|failed
  detail         JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ocr_attempts_posting ON ocr_posting_attempts (tenant_id, posting_id);

-- ── settings (tri-state tenant/branch, versioned) ───────────────────────────
CREATE TABLE IF NOT EXISTS tenant_ocr_ai_settings (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL,
  level          TEXT NOT NULL DEFAULT 'tenant',               -- tenant|branch
  branch_id      UUID,
  enabled        BOOLEAN,
  config         JSONB,
  version        INT NOT NULL DEFAULT 1,
  updated_by_user_id UUID,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ocr_settings_scope ON tenant_ocr_ai_settings (tenant_id, level, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'));

CREATE TABLE IF NOT EXISTS ocr_ai_config_versions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL,
  level          TEXT NOT NULL,
  branch_id      UUID,
  version        INT NOT NULL,
  enabled        BOOLEAN,
  config         JSONB,
  changed_by_user_id UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ocr_config_versions ON ocr_ai_config_versions (tenant_id, level, version DESC);
