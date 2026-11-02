-- 614_compensation_adjustments_wave2.sql — Payroll mandate §54 / §129 (refund after lock → next open period, linked back),
-- §55 (chargebacks tracked separately, idempotent), §59–§61 (deductions name their configured type), §63 (manual
-- adjustments carry a reason code), §186 (the same adjustment idempotency key twice = one adjustment) — Oct 12 2026, wave 2.
--   • original_period_id — the LOCKED period whose earning this entry corrects (period_id is the open period it lands in).
--   • chargeback_id      — the chargebacks row a chargeback reversal belongs to; a partial unique index makes the
--                           recovery worker's reversal one set of rows per case however often it runs.
--   • deduction_type     — compensation_deduction_types.key for category 'deduction' (no free-form deductions).
--   • reason_code        — the manual-adjustment reason code (§63); reason stays the free-text explanation.
--   • idempotency_key    — client key for a manual adjustment; unique per tenant.
--   • decided_by / decided_at / decision_reason — who approved or rejected a pending entry (the owner review queue).
-- EXPAND-ONLY, idempotent. Writers: modules/workforce compensation + payroll.
ALTER TABLE compensation_adjustments ADD COLUMN IF NOT EXISTS original_period_id UUID;
ALTER TABLE compensation_adjustments ADD COLUMN IF NOT EXISTS chargeback_id      UUID;
ALTER TABLE compensation_adjustments ADD COLUMN IF NOT EXISTS deduction_type     TEXT;
ALTER TABLE compensation_adjustments ADD COLUMN IF NOT EXISTS reason_code        TEXT;
ALTER TABLE compensation_adjustments ADD COLUMN IF NOT EXISTS idempotency_key    TEXT;
ALTER TABLE compensation_adjustments ADD COLUMN IF NOT EXISTS decided_by         UUID;
ALTER TABLE compensation_adjustments ADD COLUMN IF NOT EXISTS decided_at         TIMESTAMPTZ;
ALTER TABLE compensation_adjustments ADD COLUMN IF NOT EXISTS decision_reason    TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_comp_adj_tenant_idem
  ON compensation_adjustments (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_comp_adj_chargeback_line_tech_cat
  ON compensation_adjustments (tenant_id, chargeback_id,
                               COALESCE(service_line_id, '00000000-0000-0000-0000-000000000000'::uuid),
                               COALESCE(technician_id, '00000000-0000-0000-0000-000000000000'::uuid), category)
  WHERE chargeback_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_comp_adj_period ON compensation_adjustments (tenant_id, period_id) WHERE period_id IS NOT NULL;
DO $$
BEGIN
  PERFORM schema_apply_check('compensation_adjustments', 'chk_comp_adj_deduction_typed',
    'category <> ''deduction'' OR (deduction_type IS NOT NULL AND amount_cents < 0)', '614_compensation_adjustments_wave2.sql');
END $$;
