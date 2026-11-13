-- 950_marketing_health_runs_trigger.sql — extras Promotions Management 10 "Redemption Reconciliation" (round 10, Nov 13 2026):
-- the coupon / promotion reconciliation checks (CouponCenter.health — promotion usage vs finalized Checkout and the ledger)
-- now also run once a day on their own. A run says who started it: a person ('manual', checked_by set) or the daily
-- schedule ('scheduled', checked_by NULL). Additive only; existing rows are manual runs.
-- Rollback: ALTER TABLE marketing_health_runs DROP COLUMN trigger_type;
ALTER TABLE marketing_health_runs ADD COLUMN IF NOT EXISTS trigger_type TEXT NOT NULL DEFAULT 'manual';
DO $$ BEGIN
  ALTER TABLE marketing_health_runs ADD CONSTRAINT marketing_health_runs_trigger_check CHECK (trigger_type IN ('manual', 'scheduled'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS ix_marketing_health_runs_sched ON marketing_health_runs (tenant_id, area, trigger_type, created_at DESC);
