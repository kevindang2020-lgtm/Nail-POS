-- 126_pos_kpi_daily_snapshots.sql — per-tenant/branch/day KPI snapshots powering real day-over-day ("vs yesterday")
-- trends on POS operational dashboards (Checkout, Service Done) for metrics that cannot be reconstructed from history
-- after the fact (queue depth, satisfaction averages, accuracy, etc.). One row per (tenant, branch, business_day, module);
-- the dashboard read-path upserts the current day idempotently so the next day always has a prior row to compare against.
-- metrics is a flat JSON map of metricKey -> numeric value (integer cents for money metrics, whole/decimal otherwise).

CREATE TABLE IF NOT EXISTS pos_kpi_daily_snapshots (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  branch_id     UUID NOT NULL,
  business_day  DATE NOT NULL,
  module        TEXT NOT NULL,            -- 'checkout' | 'service_done' | ...
  metrics       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_pos_kpi_snapshot UNIQUE (tenant_id, branch_id, business_day, module)
);

CREATE INDEX IF NOT EXISTS idx_pos_kpi_snapshots_lookup
  ON pos_kpi_daily_snapshots (tenant_id, branch_id, module, business_day DESC);
