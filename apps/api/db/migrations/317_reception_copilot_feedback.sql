-- 317_reception_copilot_feedback.sql — receptionist feedback on Copilot recommendations (spec §44). References a
-- recommendation from migration 316; feeds the learning loop (#4). Tenant/branch-scoped; one latest rating per
-- (tenant, recommendation) so re-rating updates rather than duplicates. No PII — just the rating + an optional short
-- reason and safe attribution.
CREATE TABLE IF NOT EXISTS reception_copilot_feedback (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL,
  branch_id            UUID,
  recommendation_id    UUID,
  session_id           UUID,
  receptionist_user_id TEXT,
  rating               TEXT NOT NULL,   -- helpful | not_helpful | dismissed
  reason               TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, recommendation_id)
);
CREATE INDEX IF NOT EXISTS idx_rc_feedback_tenant_created ON reception_copilot_feedback (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rc_feedback_rating ON reception_copilot_feedback (tenant_id, rating);
