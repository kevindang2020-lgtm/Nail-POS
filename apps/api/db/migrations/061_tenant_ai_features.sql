-- 061_tenant_ai_features.sql — per-feature AI toggles per Super Admin spec §13. Rows are EXPLICIT OVERRIDES:
-- absent row = inherit from the tenant's AI package tier. Effective access = tier enables AI AND (override ?? true).
CREATE TABLE IF NOT EXISTS tenant_ai_features (
  tenant_id   UUID NOT NULL,
  feature_key TEXT NOT NULL CHECK (feature_key IN (
    'ai_receptionist','ai_booking','ai_customer_insights','ai_reports','ai_reminders','ai_workflow_assistant','voice_assistant'
  )),
  enabled     BOOLEAN NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, feature_key)
);
CREATE INDEX IF NOT EXISTS idx_tenant_ai_features_tenant ON tenant_ai_features (tenant_id);
