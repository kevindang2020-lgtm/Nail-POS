-- 091_ai_usage_logs.sql
-- One row per AI call (success, blocked, or provider error). Drives per-period usage totals for the access gate and the
-- Super-Admin / tenant usage analytics. Append-only.
CREATE TABLE IF NOT EXISTS ai_usage_logs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL,
  user_id             UUID,
  package_code        TEXT NOT NULL,
  action              TEXT NOT NULL DEFAULT 'invoke',
  model_provider      TEXT,
  model_name          TEXT,
  input_tokens        INTEGER NOT NULL DEFAULT 0,
  output_tokens       INTEGER NOT NULL DEFAULT 0,
  total_tokens        INTEGER NOT NULL DEFAULT 0,
  cost_estimate_cents INTEGER NOT NULL DEFAULT 0,
  usage_unit          TEXT NOT NULL DEFAULT 'calls',
  usage_amount        INTEGER NOT NULL DEFAULT 0,
  status              TEXT NOT NULL DEFAULT 'success'
                        CHECK (status IN ('success','failed','blocked_unpaid','blocked_limit','blocked_permission','provider_error')),
  error_message       TEXT,
  request_id          TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_tenant_pkg ON ai_usage_logs (tenant_id, package_code, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_period ON ai_usage_logs (tenant_id, package_code, status, created_at);
