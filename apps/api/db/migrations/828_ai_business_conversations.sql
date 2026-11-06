-- 828_ai_business_conversations.sql — A4 AI Business Assistant guide, the parts listed as "not built" (Nov 6 2026).
-- A stored, searchable conversation history: one row per question asked (who, which period, the intent / tool, the answer
-- text and the period's headline numbers). Private to the person who asked (an owner sees their own, a manager theirs).
-- Retention: 365 days, then deleted by the central retention executor (retention-policy.json) — a year of questions is
-- enough to look back; the numbers themselves live in the Sales Report forever.
-- ai_business_health_runs gains area 'assistant' for the "Check Business Data" button.
CREATE TABLE IF NOT EXISTS ai_business_conversations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  branch_id     UUID,
  user_id       UUID NOT NULL,
  question      TEXT,
  intent        TEXT,
  tool_used     TEXT,
  preset        TEXT,
  period_from   DATE,
  period_to     DATE,
  answer        TEXT,
  answered_by   TEXT NOT NULL CHECK (answered_by IN ('ai', 'numbers_only', 'clarification', 'records')),
  language      TEXT,
  headline      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_ai_business_conversations_user ON ai_business_conversations (tenant_id, user_id, created_at DESC);
ALTER TABLE ai_business_health_runs DROP CONSTRAINT IF EXISTS ai_business_health_runs_area_check;
ALTER TABLE ai_business_health_runs ADD CONSTRAINT ai_business_health_runs_area_check CHECK (area IN ('reports', 'alerts', 'branches', 'assistant'));
