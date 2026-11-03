-- 781_ai_business_reports_alerts.sql — AI Business Reports + AI Business Alerts guides (Nov 3 2026). Additive only.
-- Rollback: DROP TABLE ai_business_alert_events, ai_business_health_runs.
-- Report jobs (338) and alert rules (337) stay as they are. This adds:
--   • ai_business_alert_events — one row per evaluation of a rule (value, threshold, sample, the exact salon-local period, whether
--     the state changed: triggered / recovered / unchanged / not_evaluated), so an alert has a history instead of two timestamps;
--     a triggered event can be acknowledged (who, when, note) — the only update the table allows.
--   • ai_business_health_runs — evidence for the read-only "Check AI Business Reports / Alerts System" (area = reports | alerts).
CREATE TABLE IF NOT EXISTS ai_business_alert_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id),
  branch_id        UUID,
  alert_id         UUID NOT NULL REFERENCES ai_business_alerts(id) ON DELETE CASCADE,
  source           TEXT NOT NULL CHECK (source IN ('manual', 'scheduled')),
  metric_id        TEXT NOT NULL,
  operator         TEXT NOT NULL,
  threshold        NUMERIC NOT NULL,
  preset           TEXT NOT NULL,
  period_from      DATE,
  period_to        DATE,
  value            NUMERIC,
  sample_size      INTEGER,
  min_sample_size  INTEGER,
  sample_ok        BOOLEAN NOT NULL,
  triggered        BOOLEAN NOT NULL,
  state_change     TEXT NOT NULL CHECK (state_change IN ('triggered', 'recovered', 'unchanged', 'not_evaluated')),
  reason           TEXT,
  actor_user_id    UUID,
  acknowledged_at  TIMESTAMPTZ,
  acknowledged_by  UUID,
  ack_note         TEXT,
  evaluated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_ai_business_alert_events_recent ON ai_business_alert_events (tenant_id, evaluated_at DESC);
CREATE INDEX IF NOT EXISTS ix_ai_business_alert_events_alert ON ai_business_alert_events (tenant_id, alert_id, evaluated_at DESC);
CREATE TABLE IF NOT EXISTS ai_business_health_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  branch_id     UUID,
  area          TEXT NOT NULL CHECK (area IN ('reports', 'alerts')),
  actor_user_id UUID,
  overall       TEXT NOT NULL CHECK (overall IN ('PASSED', 'WARNING', 'FAILED', 'INSUFFICIENT_DATA')),
  checks        JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_ai_business_health_recent ON ai_business_health_runs (tenant_id, area, created_at DESC);
