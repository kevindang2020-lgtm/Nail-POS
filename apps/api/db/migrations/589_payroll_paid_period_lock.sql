-- 589_payroll_paid_period_lock.sql — merge of the other chat's 472 (Oct 12 2026), Payroll mandate §73–§74 (locked payroll
-- is financial history) and §124 (reopen records why and who).
--   • payroll_lines: BEFORE UPDATE OR DELETE trigger refuses any change to a line whose period is in status 'paid' — the
--     lock holds AT THE DATABASE, not only in PayrollService (which already refuses a transition out of 'paid'). A paid
--     period's corrections go through the compensation_adjustments ledger (a future period), never by editing history.
--   • payroll_periods: reopening a finalized period records WHY and WHO (reopen_reason / reopened_by / reopened_at) —
--     the service refuses a reopen without a reason and writes a high-severity audit row.
-- EXPAND-ONLY, idempotent (function is CREATE OR REPLACE; trigger is dropped + recreated). Writers: modules/workforce payroll.
ALTER TABLE payroll_periods ADD COLUMN IF NOT EXISTS reopen_reason TEXT;
ALTER TABLE payroll_periods ADD COLUMN IF NOT EXISTS reopened_by   UUID;
ALTER TABLE payroll_periods ADD COLUMN IF NOT EXISTS reopened_at   TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION payroll_lines_paid_period_lock() RETURNS trigger AS $$
DECLARE s TEXT;
BEGIN
  SELECT status INTO s FROM payroll_periods WHERE id = OLD.period_id;
  IF s = 'paid' THEN
    RAISE EXCEPTION 'payroll period % is paid; its lines are locked (% refused)', OLD.period_id, TG_OP
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_payroll_lines_paid_lock ON payroll_lines;
CREATE TRIGGER trg_payroll_lines_paid_lock BEFORE UPDATE OR DELETE ON payroll_lines
  FOR EACH ROW EXECUTE FUNCTION payroll_lines_paid_period_lock();
