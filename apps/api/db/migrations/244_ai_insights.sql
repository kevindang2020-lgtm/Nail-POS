-- 184_ai_insights.sql
-- AI Insights: AI-generated operational FINDINGS across the platform. These are RECOMMENDATIONS ONLY — no row here
-- ever triggers a destructive action; acting on a finding happens through the relevant operational module by an
-- authorized human. Every insight records its tenant/branch scope, model + prompt version (never overwritten), a
-- confidence value AND the method that produced it (confidence is not accuracy), and a controlled status lifecycle.
CREATE TABLE IF NOT EXISTS ai_insights (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  insight_reference  TEXT NOT NULL,
  tenant_id          UUID,
  tenant_name        TEXT,
  branch_id          UUID,
  branch_name        TEXT,
  category           TEXT NOT NULL CHECK (category IN (
    'BOOKING_DECLINE','CANCELLATION_RISK','WAIT_TIME','TECHNICIAN_UTILIZATION','UNUSUAL_TRANSACTION',
    'HIGH_PERFORMING_SERVICE','CUSTOMER_CHURN_RISK','MARKETING_OPPORTUNITY','STAFFING_SHORTAGE','PRODUCT_DEMAND','AI_RECEPTIONIST_ISSUE')),
  title              TEXT NOT NULL,
  summary            TEXT,
  recommendation     TEXT,
  severity           TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('critical','high','medium','low','informational')),
  confidence         INTEGER,                         -- 0..100, or NULL when the model produced none
  confidence_method  TEXT,                            -- e.g. calibrated_probability | rule_confidence | ensemble_agreement
  status             TEXT NOT NULL DEFAULT 'new' CHECK (status IN (
    'new','open','in_review','follow_up_assigned','monitoring','action_recommended','resolved','dismissed','expired','superseded','escalated','archived')),
  affected_start_at  TIMESTAMPTZ,
  affected_end_at    TIMESTAMPTZ,
  source_cutoff_at   TIMESTAMPTZ,
  generated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_evaluated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at         TIMESTAMPTZ,
  freshness          TEXT NOT NULL DEFAULT 'current' CHECK (freshness IN ('current','updating','delayed','stale','expired','source_unavailable')),
  model_provider     TEXT,
  model_name         TEXT,
  model_version      TEXT,
  prompt_version     TEXT,
  detector_version   TEXT,
  deduplication_key  TEXT,
  occurrence_count   INTEGER NOT NULL DEFAULT 1,
  churn_risk_score   INTEGER,                         -- for tenant-risk aggregation (0..100), nullable
  flagged_amount_cents BIGINT,                        -- for transaction-anomaly findings (integer cents), nullable
  assigned_to_user_id UUID,
  reviewed_at        TIMESTAMPTZ,
  reviewed_by_user_id UUID,
  resolved_at        TIMESTAMPTZ,
  dismissed_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (confidence IS NULL OR (confidence BETWEEN 0 AND 100)),
  CHECK (occurrence_count >= 1)
);

-- Deduplication: at most one active insight per dedup key (partial — dismissed/expired/superseded/archived don't block).
CREATE UNIQUE INDEX IF NOT EXISTS ux_ai_insight_dedup_active ON ai_insights (deduplication_key)
  WHERE deduplication_key IS NOT NULL AND status NOT IN ('dismissed','expired','superseded','archived','resolved');
CREATE INDEX IF NOT EXISTS ix_ai_insights_tenant   ON ai_insights (tenant_id);
CREATE INDEX IF NOT EXISTS ix_ai_insights_branch   ON ai_insights (branch_id);
CREATE INDEX IF NOT EXISTS ix_ai_insights_category ON ai_insights (category);
CREATE INDEX IF NOT EXISTS ix_ai_insights_severity ON ai_insights (severity);
CREATE INDEX IF NOT EXISTS ix_ai_insights_status   ON ai_insights (status);
CREATE INDEX IF NOT EXISTS ix_ai_insights_generated ON ai_insights (generated_at DESC);
