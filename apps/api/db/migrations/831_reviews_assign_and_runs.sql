-- 831_reviews_assign_and_runs.sql — A17 Reviews & Reputation guide, the parts listed as "not built" (Nov 6 2026).
-- 1. Assign a review to a staff member to follow up (reviews.assigned_user_id already existed, unused): who assigned it and when.
--    Every assignment is audited (review.assigned / review.unassigned).
-- 2. Recorded runs of "Check Review System" (the check stays read-only; the run row is its only write).
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS assigned_by UUID;
CREATE INDEX IF NOT EXISTS ix_reviews_assigned ON reviews (tenant_id, assigned_user_id) WHERE assigned_user_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS reviews_health_runs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  branch_id   UUID,
  overall     TEXT NOT NULL,
  checks      JSONB NOT NULL DEFAULT '[]'::jsonb,
  run_by      UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_reviews_health_runs_scope ON reviews_health_runs (tenant_id, branch_id, created_at DESC);
