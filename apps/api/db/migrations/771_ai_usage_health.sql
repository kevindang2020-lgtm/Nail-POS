-- 771_ai_usage_health.sql — AI Usage & Limits guide (Nov 1 2026). Additive only. Rollback: DROP TABLE ai_usage_health_runs.
-- The usage page's states, cost, history and alerts stay as built (migrations 723+). This adds the evidence table for the
-- read-only "Check AI Usage & Subscriptions" run.
CREATE TABLE IF NOT EXISTS ai_usage_health_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  actor_user_id UUID,
  overall       TEXT NOT NULL CHECK (overall IN ('PASSED', 'WARNING', 'FAILED', 'INSUFFICIENT_DATA')),
  checks        JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_ai_usage_health_recent ON ai_usage_health_runs (tenant_id, created_at DESC);
