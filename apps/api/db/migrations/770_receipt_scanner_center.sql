-- 770_receipt_scanner_center.sql — AI OCR Receipt Scanner guide (Nov 1 2026). Additive only.
-- Rollback: DROP TABLE receipt_scanner_health_runs; DROP INDEX ix_ocr_docs_history, ix_ocr_docs_purchase_date, ix_ocr_docs_vendor_trgm_free.
--
-- The receipt pipeline stays where it is (ocr_documents + children, migrations 344 / 359 / 700; posting through the finance
-- module's expenses and the InventoryService). This adds only what the scanner page's read side needs:
--   • indexes for the history list (newest first with a stable tie, purchase-date filter, vendor lookup);
--   • receipt_scanner_health_runs — the read-only "Check OCR System" run's evidence.

CREATE INDEX IF NOT EXISTS ix_ocr_docs_history ON ocr_documents (tenant_id, created_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_ocr_docs_purchase_date ON ocr_documents (tenant_id, document_date) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_ocr_docs_vendor_trgm_free ON ocr_documents (tenant_id, lower(vendor)) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS receipt_scanner_health_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  branch_id     UUID,
  actor_user_id UUID,
  overall       TEXT NOT NULL CHECK (overall IN ('PASSED', 'WARNING', 'FAILED', 'INSUFFICIENT_DATA')),
  checks        JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_receipt_scanner_health_recent ON receipt_scanner_health_runs (tenant_id, created_at DESC);
