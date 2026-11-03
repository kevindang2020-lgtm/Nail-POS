-- 768_review_reputation_center.sql — AI Review & Reputation guide (Nov 1 2026).
-- Additive only. Rollback: DROP TABLE review_reputation_health_runs; DROP INDEX ix_review_response_drafts_status,
-- ix_review_escalations_recent, ix_review_requests_recent.
--
-- The reviews, drafts, approvals, escalations, notes and requests stay in their tables (reviews, review_response_drafts,
-- review_response_versions, review_approvals, review_escalations, review_internal_notes, review_requests). The workspace
-- reads them with ONE metric definition for Overview, Trends and Branch Comparison. Added here: the indexes those queues
-- page on (newest first) and the read-only Check Reputation System run's evidence.
CREATE INDEX IF NOT EXISTS ix_review_response_drafts_status ON review_response_drafts (tenant_id, status, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS ix_review_escalations_recent ON review_escalations (tenant_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS ix_review_requests_recent ON review_requests (tenant_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS review_reputation_health_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  branch_id     UUID,
  actor_user_id UUID,
  overall       TEXT NOT NULL CHECK (overall IN ('PASSED', 'WARNING', 'FAILED', 'INSUFFICIENT_DATA')),
  checks        JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_review_reputation_health_recent ON review_reputation_health_runs (tenant_id, created_at DESC);
