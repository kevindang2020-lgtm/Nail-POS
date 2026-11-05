-- 359_ocr_decision_state.sql — additive: persist the AI OCR review decision state (status + approvals) as
-- structured JSON on the existing ocr_reviews row. Nullable, so it cannot affect existing data. This gives the
-- DocStore a clean home for ReviewDecisionState (approvals accumulate toward the tenant's approval requirement)
-- without abusing the free-text notes column.
ALTER TABLE ocr_reviews ADD COLUMN IF NOT EXISTS decision_state JSONB;
