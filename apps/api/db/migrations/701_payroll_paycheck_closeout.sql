-- 701_payroll_paycheck_closeout.sql — Weekly Technician Paycheck, Cash Payout & Owner Approval: the INTERNAL close-out
-- (docs/mandates/status/WEEKLY_PAYCHECK_STATUS.md, Oct 27 2026). Still the ONE payroll (no new system): four small
-- extensions of migration 673's tables.
--
--   §3.4  payroll_periods gains the CANCELED state — a period opened by mistake, closed before anything was approved
--         (draft only; its draft statements are voided, never deleted). A canceled period holds no days: the overlap
--         checks skip it and the schedule-generated unique index lets the same week be opened again.
--   §4.2  payroll_statements itemise the reversals that reversals_cents already totals: refund / void / chargeback
--         reversals, tip adjustments and retail reversals, from the adjustment ledger's categories. Totals unchanged.
--   §11.5 payroll_payouts: three more ways a technician's receipt of cash is proven — a QR handoff token the manager's
--         screen shows (its hash + expiry live on the payout; the Tech App presents it), the technician's signature
--         strokes on the manager's device, and the manager + technician dual confirmation (manager's fresh step-up and
--         the technician's PIN on the same device; who confirmed is stamped).
-- Money stays integer cents. Nothing here changes a paid / unpaid figure.

-- ── §3.4 the CANCELED pay period ────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE payroll_periods
  ADD COLUMN IF NOT EXISTS canceled_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS canceled_by    UUID,
  ADD COLUMN IF NOT EXISTS cancel_reason  TEXT;
ALTER TABLE payroll_periods DROP CONSTRAINT IF EXISTS chk_payroll_periods_status_vocab;
DO $$
BEGIN
  PERFORM schema_apply_check('payroll_periods', 'chk_payroll_periods_status_vocab',
    'status IN (''draft'', ''review'', ''finalized'', ''paid'', ''canceled'')', '701_payroll_paycheck_closeout.sql');
END $$;
-- a canceled schedule-generated week no longer occupies its slot: the weekly worker (or "Open last week") opens a fresh one
DROP INDEX IF EXISTS uq_payroll_periods_schedule_week;
CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_periods_schedule_week ON payroll_periods (tenant_id, period_start, period_end) WHERE schedule_generated AND branch_id IS NULL AND status <> 'canceled';

-- ── §4.2 itemised reversals on the statement ────────────────────────────────────────────────────────────────────────
ALTER TABLE payroll_statements
  ADD COLUMN IF NOT EXISTS refund_reversal_cents  BIGINT NOT NULL DEFAULT 0,   -- refund / void / chargeback reversals of service earnings
  ADD COLUMN IF NOT EXISTS tip_adjustment_cents   BIGINT NOT NULL DEFAULT 0,   -- tip corrections that took a tip back
  ADD COLUMN IF NOT EXISTS retail_reversal_cents  BIGINT NOT NULL DEFAULT 0;   -- the retail-commission part of a reversal
ALTER TABLE payroll_statements DROP CONSTRAINT IF EXISTS payroll_statements_reversal_items_check;
ALTER TABLE payroll_statements ADD CONSTRAINT payroll_statements_reversal_items_check
  CHECK (refund_reversal_cents >= 0 AND tip_adjustment_cents >= 0 AND retail_reversal_cents >= 0 AND refund_reversal_cents + tip_adjustment_cents + retail_reversal_cents <= reversals_cents);
-- the locked snapshot covers the itemised figures too
CREATE OR REPLACE FUNCTION payroll_statements_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('approved', 'locked', 'issued', 'partially_paid', 'paid') AND (
       NEW.service_commission_cents IS DISTINCT FROM OLD.service_commission_cents OR NEW.hourly_pay_cents IS DISTINCT FROM OLD.hourly_pay_cents
    OR NEW.salary_pay_cents IS DISTINCT FROM OLD.salary_pay_cents OR NEW.tips_cents IS DISTINCT FROM OLD.tips_cents
    OR NEW.card_tip_cents IS DISTINCT FROM OLD.card_tip_cents OR NEW.cash_tip_cents IS DISTINCT FROM OLD.cash_tip_cents
    OR NEW.retail_commission_cents IS DISTINCT FROM OLD.retail_commission_cents OR NEW.bonus_cents IS DISTINCT FROM OLD.bonus_cents
    OR NEW.guarantee_topup_cents IS DISTINCT FROM OLD.guarantee_topup_cents OR NEW.positive_adjustments_cents IS DISTINCT FROM OLD.positive_adjustments_cents
    OR NEW.deductions_cents IS DISTINCT FROM OLD.deductions_cents OR NEW.reversals_cents IS DISTINCT FROM OLD.reversals_cents
    OR NEW.refund_reversal_cents IS DISTINCT FROM OLD.refund_reversal_cents OR NEW.tip_adjustment_cents IS DISTINCT FROM OLD.tip_adjustment_cents
    OR NEW.retail_reversal_cents IS DISTINCT FROM OLD.retail_reversal_cents
    OR NEW.gross_earnings_cents IS DISTINCT FROM OLD.gross_earnings_cents OR NEW.line_payable_cents IS DISTINCT FROM OLD.line_payable_cents
    OR NEW.already_paid_cents IS DISTINCT FROM OLD.already_paid_cents OR NEW.approved_payable_cents IS DISTINCT FROM OLD.approved_payable_cents
    OR NEW.statement_number IS DISTINCT FROM OLD.statement_number OR NEW.technician_id IS DISTINCT FROM OLD.technician_id OR NEW.period_id IS DISTINCT FROM OLD.period_id) THEN
    RAISE EXCEPTION 'payroll statement % is approved and locked; correct it with an adjustment', OLD.statement_number USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'payroll statements are never deleted (void them)' USING ERRCODE = 'check_violation'; END IF;
  RETURN NEW;
END $$;

-- ── §11.5 more ways to confirm a cash handoff ───────────────────────────────────────────────────────────────────────
ALTER TABLE payroll_payouts
  ADD COLUMN IF NOT EXISTS cash_handoff_token_hash        TEXT,          -- sha256 of the QR handoff token the manager's screen shows
  ADD COLUMN IF NOT EXISTS cash_handoff_token_expires_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cash_ack_signature             TEXT,          -- the technician's signature strokes (SVG path data, never a bitmap)
  ADD COLUMN IF NOT EXISTS cash_ack_confirmed_by          UUID;          -- the manager who co-confirmed (manager_dual)
ALTER TABLE payroll_payouts DROP CONSTRAINT IF EXISTS payroll_payouts_cash_ack_method_check;
ALTER TABLE payroll_payouts ADD CONSTRAINT payroll_payouts_cash_ack_method_check
  CHECK (cash_ack_method IS NULL OR cash_ack_method IN ('technician_app', 'technician_pin', 'qr_handoff', 'signature', 'manager_dual'));
