-- 424_ai_insight_feedback.sql
-- Feedback a Super Admin submits on an AI insight. RECORDED FOR HUMAN REVIEW ONLY — no row here is ever fed back
-- into a model automatically; retraining decisions happen in the model-quality process, by people. Until Jul 28,
-- 2026 the screen's Submit Feedback button claimed a recording that had nowhere to land; this table is where it
-- lands. Each row SNAPSHOTS the insight's model/prompt version at feedback time (copied, never joined-through), so
-- a later regeneration of the insight cannot change what the reviewer was actually looking at.
CREATE TABLE IF NOT EXISTS ai_insight_feedback (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  insight_id           UUID NOT NULL REFERENCES ai_insights(id) ON DELETE CASCADE,
  insight_reference    TEXT,
  insight_title        TEXT,
  tenant_id            UUID,
  verdict              TEXT NOT NULL CHECK (verdict IN ('helpful','not_helpful','incorrect')),
  comment              TEXT,
  model_version        TEXT,
  prompt_version       TEXT,
  submitted_by_user_id UUID,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_insight_feedback_insight ON ai_insight_feedback (insight_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_insight_feedback_recent  ON ai_insight_feedback (created_at DESC);
