-- 321_ai_business_alerts.sql — business alert rules for the AI Business Assistant (spec §34).
-- Tenant-scoped; branch_id NULL = all authorized branches. A rule watches ONE bounded metric and fires when its
-- current value crosses a threshold, subject to a minimum sample size (so a tiny sample can't trip an alert).
-- last_triggered_at + last_checked_at support duplicate-storm suppression when the scheduled evaluator lands.
CREATE TABLE IF NOT EXISTS ai_business_alerts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL,
  branch_id        UUID,                                 -- NULL = all authorized branches
  created_by_user_id UUID NOT NULL,
  title            TEXT NOT NULL,
  metric_id        TEXT NOT NULL
    CHECK (metric_id IN ('net_sales','average_ticket','completed_appointments','cancellation_rate','no_show_rate','customer_retention')),
  operator         TEXT NOT NULL CHECK (operator IN ('lt','gt')),
  threshold        BIGINT NOT NULL,                      -- cents for money metrics, count for counts, percent for rates
  preset           TEXT NOT NULL DEFAULT 'today',
  min_sample_size  INTEGER NOT NULL DEFAULT 5,
  frequency        TEXT NOT NULL DEFAULT 'daily' CHECK (frequency IN ('hourly','daily')),
  channel          TEXT NOT NULL DEFAULT 'in_app' CHECK (channel IN ('in_app','email','sms')),
  active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_checked_at  TIMESTAMPTZ,
  last_triggered_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS ai_business_alerts_tenant_idx ON ai_business_alerts (tenant_id, active);
CREATE INDEX IF NOT EXISTS ai_business_alerts_tenant_branch_idx ON ai_business_alerts (tenant_id, branch_id);
