-- 780_ai_marketing_health_runs.sql — AI Marketing Assistant family guides (Nov 3 2026). Additive only.
-- Rollback: DROP TABLE ai_marketing_health_runs.
-- Campaigns, recipients, sends, consent and attribution stay where they are (Campaign Center, Customer Segments, the send ledger);
-- the assistant only reads them. This is the evidence table for the read-only "Check AI Marketing System".
CREATE TABLE IF NOT EXISTS ai_marketing_health_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  branch_id     UUID,
  actor_user_id UUID,
  overall       TEXT NOT NULL CHECK (overall IN ('PASSED', 'WARNING', 'FAILED', 'INSUFFICIENT_DATA')),
  checks        JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_ai_marketing_health_recent ON ai_marketing_health_runs (tenant_id, created_at DESC);
