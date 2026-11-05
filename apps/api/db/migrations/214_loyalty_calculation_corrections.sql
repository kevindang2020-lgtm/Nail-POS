-- 178_loyalty_calculation_corrections.sql — a real store for the "Correct Platform Calculation Errors" workflow.
-- Cases are DERIVED from verifiable arithmetic inconsistencies in real data (balance vs earned−redeemed, redeemed vs
-- sum of redemptions, negative balances). The workflow is investigate → propose → approve | reject, recording an
-- append-only COMPENSATING correction record. It never silently edits customer balances or ledger history; actually
-- re-writing tenant points requires the immutable points ledger (a foundational POS subsystem, out of this surface).
CREATE TABLE IF NOT EXISTS loyalty_calculation_corrections (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL,
  customer_id        UUID,
  discrepancy_type   TEXT NOT NULL,                    -- balance_mismatch | redeemed_mismatch | negative_balance
  expected_points    BIGINT NOT NULL DEFAULT 0,
  actual_points      BIGINT NOT NULL DEFAULT 0,
  difference_points  BIGINT NOT NULL DEFAULT 0,        -- expected − actual (signed)
  status             TEXT NOT NULL DEFAULT 'detected', -- detected | proposed | approved | rejected
  proposed_adjustment_points BIGINT,
  root_cause         TEXT,
  reason             TEXT,
  bucket_key         TEXT NOT NULL,                    -- tenant|customer|type (idempotent)
  detail_json        JSONB NOT NULL DEFAULT '{}'::jsonb,
  reviewed_by        UUID,
  detected_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_loyalty_corr_bucket ON loyalty_calculation_corrections (bucket_key);
CREATE INDEX IF NOT EXISTS ix_loyalty_corr_status ON loyalty_calculation_corrections (status, detected_at DESC);
CREATE INDEX IF NOT EXISTS ix_loyalty_corr_tenant ON loyalty_calculation_corrections (tenant_id, status);
