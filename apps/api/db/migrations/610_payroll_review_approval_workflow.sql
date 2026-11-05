-- 610_payroll_review_approval_workflow.sql — Payroll mandate wave 2 (Oct 12 2026): §66–§77 review / approval / lock,
-- §119–§121 calculation version + approval integrity hash, §38–§44 hourly / salary components, §59–§61 deductions,
-- §150 negative pay, §151 owner dashboard status.
--
--   payroll_periods
--     • status gains 'review' (READY_FOR_REVIEW): draft (OPEN) → review → finalized (APPROVED + LOCKED) → paid. The machine
--       lives in modules/workforce payroll.dto.ts (PAYROLL_PERIOD); this CHECK is its vocabulary.
--     • version — optimistic concurrency (§75–§77): every write bumps it; approve / reopen / pay carry expectedVersion and a
--       stale one is PAYROLL_VERSION_CONFLICT (two owners approving = one transition).
--     • calculation_version / preview_hash (prepare) / approval_hash + approved_by (approve) — the hash is sha256 over the
--       canonical line set, so an approved period is tamper-evident: a recomputed hash that differs from approval_hash
--       means somebody changed a locked figure outside the workflow (§121).
--     • validation_json + blocking_count + warning_count — the last pre-approval validation (§143–§145), so the period list
--       can show NEEDS REVIEW / READY TO APPROVE / HAS EXCEPTIONS without recomputing (§151).
--     • pay_date — the planned pay date (§65).
--   payroll_lines: hourly_pay_cents + worked_minutes + potential_overtime_minutes (§38–§42, from the time clock),
--     salary_pay_cents (§43), bonus_cents (§62, split out of adjustments), deduction_cents (§59–§61, never from tips),
--     net_cents (signed; payable_cents stays the non-negative amount owed) and review_required (§150 negative net).
--   The paid-period line lock (589) widens: a line is frozen while its period is in review, finalized or paid — the only
--     way to change it is to send the period back to draft (review) or reopen it with a reason (finalized).
-- EXPAND-ONLY, idempotent. Writers: modules/workforce payroll (payroll.kysely.repository.ts, payroll-workflow.ts).
ALTER TABLE payroll_periods ADD COLUMN IF NOT EXISTS version             INTEGER NOT NULL DEFAULT 1;
ALTER TABLE payroll_periods ADD COLUMN IF NOT EXISTS calculation_version TEXT;
ALTER TABLE payroll_periods ADD COLUMN IF NOT EXISTS preview_hash        TEXT;
ALTER TABLE payroll_periods ADD COLUMN IF NOT EXISTS prepared_at         TIMESTAMPTZ;
ALTER TABLE payroll_periods ADD COLUMN IF NOT EXISTS prepared_by         UUID;
ALTER TABLE payroll_periods ADD COLUMN IF NOT EXISTS approval_hash       TEXT;
ALTER TABLE payroll_periods ADD COLUMN IF NOT EXISTS approved_by         UUID;
ALTER TABLE payroll_periods ADD COLUMN IF NOT EXISTS paid_by             UUID;
ALTER TABLE payroll_periods ADD COLUMN IF NOT EXISTS validation_json     JSONB;
ALTER TABLE payroll_periods ADD COLUMN IF NOT EXISTS blocking_count      INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payroll_periods ADD COLUMN IF NOT EXISTS warning_count       INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payroll_periods ADD COLUMN IF NOT EXISTS pay_date            DATE;
ALTER TABLE payroll_periods ADD COLUMN IF NOT EXISTS updated_by          UUID;

ALTER TABLE payroll_periods DROP CONSTRAINT IF EXISTS chk_payroll_periods_status_vocab;
DO $$
BEGIN
  PERFORM schema_apply_check('payroll_periods', 'chk_payroll_periods_status_vocab',
    'status IN (''draft'', ''review'', ''finalized'', ''paid'')', '610_payroll_review_approval_workflow.sql');
  PERFORM schema_apply_check('payroll_periods', 'chk_payroll_periods_version_positive', 'version >= 1', '610_payroll_review_approval_workflow.sql');
END $$;

ALTER TABLE payroll_lines ADD COLUMN IF NOT EXISTS hourly_pay_cents           BIGINT  NOT NULL DEFAULT 0;
ALTER TABLE payroll_lines ADD COLUMN IF NOT EXISTS worked_minutes             INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payroll_lines ADD COLUMN IF NOT EXISTS potential_overtime_minutes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payroll_lines ADD COLUMN IF NOT EXISTS salary_pay_cents           BIGINT  NOT NULL DEFAULT 0;
ALTER TABLE payroll_lines ADD COLUMN IF NOT EXISTS bonus_cents                BIGINT  NOT NULL DEFAULT 0;
ALTER TABLE payroll_lines ADD COLUMN IF NOT EXISTS deduction_cents            BIGINT  NOT NULL DEFAULT 0;
ALTER TABLE payroll_lines ADD COLUMN IF NOT EXISTS net_cents                  BIGINT  NOT NULL DEFAULT 0;
ALTER TABLE payroll_lines ADD COLUMN IF NOT EXISTS review_required            BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE payroll_lines ADD COLUMN IF NOT EXISTS updated_by                 UUID;
DROP TRIGGER IF EXISTS trg_payroll_lines_paid_lock ON payroll_lines;
-- existing rows: net == payable (they were computed with the floor, so a negative never reached them)
UPDATE payroll_lines SET net_cents = payable_cents WHERE net_cents = 0 AND payable_cents <> 0;
DO $$
BEGIN
  PERFORM schema_apply_check('payroll_lines', 'chk_payroll_lines_payable_nonneg', 'payable_cents >= 0', '610_payroll_review_approval_workflow.sql');
  PERFORM schema_apply_check('payroll_lines', 'chk_payroll_lines_deduction_nonneg', 'deduction_cents >= 0', '610_payroll_review_approval_workflow.sql');
END $$;

CREATE OR REPLACE FUNCTION payroll_lines_paid_period_lock() RETURNS trigger AS $$
DECLARE s TEXT; pid UUID;
BEGIN
  pid := CASE WHEN TG_OP = 'INSERT' THEN NEW.period_id ELSE OLD.period_id END;
  SELECT status INTO s FROM payroll_periods WHERE id = pid;
  IF s IN ('review', 'finalized', 'paid') THEN
    RAISE EXCEPTION 'payroll period % is %; its lines are locked (% refused)', pid, s, TG_OP
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_payroll_lines_paid_lock ON payroll_lines;
CREATE TRIGGER trg_payroll_lines_paid_lock BEFORE INSERT OR UPDATE OR DELETE ON payroll_lines
  FOR EACH ROW EXECUTE FUNCTION payroll_lines_paid_period_lock();

CREATE INDEX IF NOT EXISTS idx_payroll_lines_tenant_period ON payroll_lines (tenant_id, period_id);
CREATE INDEX IF NOT EXISTS idx_payroll_lines_tenant_tech   ON payroll_lines (tenant_id, technician_id);
