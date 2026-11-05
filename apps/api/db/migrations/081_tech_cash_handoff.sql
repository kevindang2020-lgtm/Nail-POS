-- 081_tech_cash_handoff.sql — End-of-day cash hand-off & reconciliation, per technician.
-- A technician collects cash during the day via Skip-the-Line "cash to technician" payments
-- (recorded in cash_payment_confirmations with the collecting technician_id). At shift end the
-- tech hands the cash to the front desk, who counts it and reconciles against the system-expected
-- amount. One hand-off row per technician per business date.
CREATE TABLE IF NOT EXISTS tech_cash_handoffs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL,
  branch_id             uuid,
  technician_id         uuid NOT NULL,
  business_date         date NOT NULL,
  expected_cents        bigint NOT NULL DEFAULT 0,   -- system-computed cash the tech collected that day
  counted_cents         bigint,                      -- physical cash counted by the front desk
  variance_cents        bigint,                      -- counted - expected (over = +, short = -)
  payment_count         integer NOT NULL DEFAULT 0,
  status                text NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open','submitted','reconciled','discrepancy','cancelled')),
  submitted_by_user_id  uuid,
  submitted_at          timestamptz,
  reconciled_by_user_id uuid,
  reconciled_at         timestamptz,
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, technician_id, business_date)
);
CREATE INDEX IF NOT EXISTS idx_tech_cash_handoffs_tenant_date ON tech_cash_handoffs (tenant_id, business_date);
CREATE INDEX IF NOT EXISTS idx_tech_cash_handoffs_tech ON tech_cash_handoffs (tenant_id, technician_id, business_date);
