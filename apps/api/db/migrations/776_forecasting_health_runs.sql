-- 776_forecasting_health_runs.sql — AI Analytics & Forecasting guide (Nov 2 2026). Additive only.
-- Rollback: DROP TABLE forecasting_health_runs.
--
-- The forecasts themselves stay where they are (forecast_points, migration 340: one row per run + target date, realized
-- value filled when the date matures). This adds only the evidence table for the read-only
-- "Check AI Analytics & Forecasting System": each run's overall state and its checks, so "last success" is a fact.
CREATE TABLE IF NOT EXISTS forecasting_health_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  branch_id     UUID,
  actor_user_id UUID,
  overall       TEXT NOT NULL CHECK (overall IN ('PASSED', 'WARNING', 'FAILED', 'INSUFFICIENT_DATA')),
  checks        JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_forecasting_health_recent ON forecasting_health_runs (tenant_id, created_at DESC);
-- the run history list groups forecast_points by run, newest first
CREATE INDEX IF NOT EXISTS ix_forecast_points_run ON forecast_points (tenant_id, generated_at DESC, run_id);
