-- 466_usage_alerts.sql — Constitution 7 §41: usage alerts at 80% / 90% / 100% of a plan limit.
-- One row per tenant, metric, threshold and PERIOD (calendar month, 'YYYY-MM'): the UNIQUE key makes the sweep
-- idempotent — each threshold alerts once per month, however often the sweep runs or how many workers run it. The row
-- is the platform-side record (billing / operations read it); the tenant owner gets an owner-only alert alongside.
CREATE TABLE IF NOT EXISTS usage_alerts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  metric       TEXT NOT NULL,
  threshold    INT  NOT NULL CHECK (threshold IN (80, 90, 100)),
  period       TEXT NOT NULL,
  used         NUMERIC NOT NULL,
  limit_value  NUMERIC NOT NULL,
  pct          NUMERIC NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_usage_alerts_once ON usage_alerts (tenant_id, metric, threshold, period);
CREATE INDEX IF NOT EXISTS idx_usage_alerts_recent ON usage_alerts (created_at DESC);
