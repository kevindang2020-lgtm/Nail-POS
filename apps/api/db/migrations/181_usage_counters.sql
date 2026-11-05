-- 181_usage_counters.sql — period-scoped usage counters for usage-based metrics (AI minutes, SMS, email, storage,
-- appointments, AI receptionist calls). Feeds the entitlement engine's "used" values so utilization + overage cover
-- these metrics, not just operational counts. One row per (tenant, metric, billing period). Values are BIGINT.

CREATE TABLE IF NOT EXISTS usage_counters (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  metric         text NOT NULL,
  billing_period text NOT NULL,                 -- 'YYYY-MM'
  used_value     bigint NOT NULL DEFAULT 0,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, metric, billing_period)
);
CREATE INDEX IF NOT EXISTS idx_usage_counters_period ON usage_counters (billing_period, metric);
