-- 093_ai_usage_cost.sql — precise per-call AI cost. cost_estimate_cents (091) is integer cents and rounds sub-cent calls
-- to 0; this adds micro-USD (1e-6 USD) precision so per-package COGS sums are meaningful. Populated at write-time from
-- the logged token counts × the per-model price table.
ALTER TABLE ai_usage_logs ADD COLUMN IF NOT EXISTS cost_micro_usd BIGINT NOT NULL DEFAULT 0;
