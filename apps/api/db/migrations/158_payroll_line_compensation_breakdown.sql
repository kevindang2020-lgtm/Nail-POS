-- 158_payroll_line_compensation_breakdown.sql — persist the canonical compensation breakdown on payroll lines so the
-- guarantee top-up (§6/§19) and the retail/card/cash split (§18/§20) are visible in payroll and reconcile to the
-- immutable snapshot. Additive + idempotent; existing payroll_lines keep working (columns default to 0).
ALTER TABLE payroll_lines ADD COLUMN IF NOT EXISTS retail_commission_cents BIGINT NOT NULL DEFAULT 0;
ALTER TABLE payroll_lines ADD COLUMN IF NOT EXISTS card_tip_cents          BIGINT NOT NULL DEFAULT 0;
ALTER TABLE payroll_lines ADD COLUMN IF NOT EXISTS cash_tip_cents          BIGINT NOT NULL DEFAULT 0;
ALTER TABLE payroll_lines ADD COLUMN IF NOT EXISTS guarantee_topup_cents   BIGINT NOT NULL DEFAULT 0;
