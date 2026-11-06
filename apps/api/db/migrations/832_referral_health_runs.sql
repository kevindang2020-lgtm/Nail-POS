-- 832_referral_health_runs.sql — A18 Referral Program guide (Nov 6 2026): recorded runs of "Check Referral System".
-- The check stays read-only; POST health/run records the run (its only write). GET health stays as it was.
CREATE TABLE IF NOT EXISTS referral_health_runs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  branch_id   UUID,
  overall     TEXT NOT NULL,
  items       JSONB NOT NULL DEFAULT '[]'::jsonb,
  run_by      UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_referral_health_runs_scope ON referral_health_runs (tenant_id, branch_id, created_at DESC);
