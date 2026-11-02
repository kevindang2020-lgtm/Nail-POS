-- 700_receipt_expense_ocr_close.sql — Receipt, Expense, Invoice, OCR & Accounting mandate (Oct 27 2026): the INTERNAL rows
-- that were NOT DONE / PARTIAL on the committed tree. EXPAND-ONLY and idempotent; every existing row keeps today's behaviour.
--
--   §17/§18   multi-page receipts: ocr_documents.page_count (the pages live in ocr_document_pages, one row per page file)
--   §12       source_channel is now what the CALLER said (pos_upload / owner_app_upload / mobile_camera / web_upload / api_import)
--   §25/§26   quality_flags — the cheap pre-OCR heuristics (low resolution, dark, blurry, tiny file); the client shows
--             "Receipt may be difficult to read — Retake / Process anyway"; nothing fails on a flag
--   §24/§159  derivatives: ocr_document_files.kind already allows 'processed' (the OCR copy) and 'thumbnail' (lists)
--   §113–115  OCR off the request thread: extraction is a durable job (jobs table, class 'ai'); extraction_attempts /
--             next_extraction_at / last_extraction_error record the ladder; the terminal state after the cap is
--             extraction_failed (the DLQ a person retries) — surfaced on the Super Admin overview
--   §142      receipt → EXISTING expense suggestion (suggested_expense_id + suggested_match MATCHED/POSSIBLE_MATCH/UNMATCHED);
--             a person links it (attachDocument) — never auto-linked
--   §62/§63   expense ↔ payment / bank transaction link with the same verdict vocabulary; never fabricated (null = nothing
--             was matched; 'unmatched' = a match was looked for and none found)
--   §83       optional low-risk auto-approval rules (owner-defined: trusted vendor under a threshold); the OWNER's rule is the
--             authority, never the AI alone
--   §177–179  owner notification preferences (needs review, bill due, duplicate, weekly summary, monthly summary) and the
--             once-per-period markers the digests use so a restart / second replica never sends twice
--   §131      retention: retention_archived_at on ocr_documents — the nightly retention tick ARCHIVES (never deletes)

-- ── ocr_documents ───────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE ocr_documents
  ADD COLUMN IF NOT EXISTS page_count            INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS quality_flags         JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS extraction_attempts   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_extraction_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_extraction_error TEXT,
  ADD COLUMN IF NOT EXISTS suggested_expense_id  UUID,
  ADD COLUMN IF NOT EXISTS suggested_match       TEXT,
  ADD COLUMN IF NOT EXISTS retention_archived_at TIMESTAMPTZ;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ocr_documents_page_count_chk') THEN
    ALTER TABLE ocr_documents ADD CONSTRAINT ocr_documents_page_count_chk CHECK (page_count BETWEEN 1 AND 100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ocr_documents_quality_flags_chk') THEN
    ALTER TABLE ocr_documents ADD CONSTRAINT ocr_documents_quality_flags_chk CHECK (jsonb_typeof(quality_flags) = 'array');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ocr_documents_suggested_match_chk') THEN
    ALTER TABLE ocr_documents ADD CONSTRAINT ocr_documents_suggested_match_chk CHECK (suggested_match IS NULL OR suggested_match IN ('matched', 'possible_match', 'unmatched'));
  END IF;
END $$;
-- the extraction job's population (documents due for a retry) and the retention tick's population
CREATE INDEX IF NOT EXISTS idx_ocr_docs_next_extraction ON ocr_documents (next_extraction_at) WHERE next_extraction_at IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ocr_docs_retention ON ocr_documents (tenant_id, created_at) WHERE retention_archived_at IS NULL AND deleted_at IS NULL;

-- ── expenses: payment / bank transaction link (§62/§63) ─────────────────────────────────────────────────────────────
ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS payment_match_status TEXT,
  ADD COLUMN IF NOT EXISTS matched_payment_id   UUID,
  ADD COLUMN IF NOT EXISTS matched_payment_ref  TEXT,
  ADD COLUMN IF NOT EXISTS payment_match_reason TEXT,
  ADD COLUMN IF NOT EXISTS payment_matched_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payment_matched_by   UUID;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expenses_payment_match_status_chk') THEN
    ALTER TABLE expenses ADD CONSTRAINT expenses_payment_match_status_chk CHECK (payment_match_status IS NULL OR payment_match_status IN ('matched', 'possible_match', 'unmatched'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_expenses_payment_match ON expenses (tenant_id, payment_match_status) WHERE payment_match_status = 'possible_match';

-- ── expense_settings: notification preferences (§177), digest markers (§178/§179), auto-approval rules (§83) ─────────
ALTER TABLE expense_settings
  ADD COLUMN IF NOT EXISTS notify_needs_review     BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_bill_due         BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_duplicate        BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_weekly_summary   BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_monthly_summary  BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS weekly_summary_sent_for  TEXT,    -- the Monday (YYYY-MM-DD) of the last week summarised
  ADD COLUMN IF NOT EXISTS monthly_summary_sent_for TEXT,    -- the month (YYYY-MM) last summarised
  ADD COLUMN IF NOT EXISTS auto_approval_rules     JSONB NOT NULL DEFAULT '[]'::jsonb;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expense_settings_auto_approval_rules_chk') THEN
    ALTER TABLE expense_settings ADD CONSTRAINT expense_settings_auto_approval_rules_chk CHECK (jsonb_typeof(auto_approval_rules) = 'array');
  END IF;
END $$;
