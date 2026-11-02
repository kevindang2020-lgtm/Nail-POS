-- 324_forecast_points.sql — persisted forecast predictions for the AI Analytics & Forecasting module. Each row is ONE
-- predicted target date from ONE forecast run (domain + model + version), storing the point and its 80% prediction
-- interval. Later, when the target date has matured, realized_value is filled in from AUTHORITATIVE actuals and abs_error
-- computed — this is what makes accuracy claims durable and honest (realized WAPE/coverage over time), rather than only the
-- in-run backtest. Tenant+branch scoped. No PII; values are aggregate counts/cents. Nothing here drives an action.
CREATE TABLE IF NOT EXISTS forecast_points (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL,
  branch_id      UUID NOT NULL,
  run_id         UUID NOT NULL,                       -- groups all target dates of one forecast run
  domain         TEXT NOT NULL
    CHECK (domain IN ('appointments','revenue','product_demand')),
  entity_id      UUID,                                -- e.g. product_id for product_demand; NULL for branch-level domains
  model          TEXT NOT NULL,
  model_version  TEXT NOT NULL DEFAULT 'v1',
  horizon_step   INT  NOT NULL,
  target_date    DATE NOT NULL,
  point_value    NUMERIC(16,4) NOT NULL,
  lower_value    NUMERIC(16,4) NOT NULL,
  upper_value    NUMERIC(16,4) NOT NULL,
  interval_level NUMERIC(4,3) NOT NULL DEFAULT 0.8,
  confidence     TEXT,
  data_quality   TEXT,
  backtest_wape  NUMERIC(8,4),                        -- in-run backtest WAPE at generation (may be NULL)
  realized_value NUMERIC(16,4),                       -- filled when the target date matures (from authoritative actuals)
  abs_error      NUMERIC(16,4),                       -- |realized − point|, filled with realized_value
  within_interval BOOLEAN,                            -- realized within [lower,upper]? (coverage tracking)
  realized_at    TIMESTAMPTZ,
  generated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Accuracy queries: a tenant's points for a domain around a date; and matured-but-unrealized points to evaluate.
CREATE INDEX IF NOT EXISTS forecast_points_domain_idx
  ON forecast_points (tenant_id, branch_id, domain, target_date);
CREATE INDEX IF NOT EXISTS forecast_points_unrealized_idx
  ON forecast_points (tenant_id, domain, target_date)
  WHERE realized_value IS NULL;
-- One stored prediction per (run, target date, entity) — a re-run writes a new run_id, so history is preserved.
CREATE UNIQUE INDEX IF NOT EXISTS forecast_points_unique_idx
  ON forecast_points (run_id, target_date, COALESCE(entity_id, '00000000-0000-0000-0000-000000000000'::uuid));
