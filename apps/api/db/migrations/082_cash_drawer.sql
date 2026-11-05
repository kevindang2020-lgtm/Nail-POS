-- 082_cash_drawer.sql — Front-desk cash drawer (register) reconciliation, per branch per business date.
-- Register cash = cash sales rung up at the POS checkout (NOT the Skip-the-Line "cash to technician" payments, which
-- are physically held by techs and reconciled separately in tech_cash_handoffs). At end of day the front desk counts
-- the physical drawer and reconciles against the expected amount = opening float + cash sales - cash refunds.
CREATE TABLE IF NOT EXISTS cash_drawer_sessions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL,
  branch_id             uuid NOT NULL,
  business_date         date NOT NULL,
  opening_float_cents   bigint NOT NULL DEFAULT 0,
  expected_sales_cents  bigint,            -- snapshot at reconcile (register cash sales)
  refunds_cents         bigint,            -- snapshot at reconcile (cash refunds paid out)
  expected_cash_cents   bigint,            -- snapshot at reconcile (float + sales - refunds)
  counted_cents         bigint,            -- physical drawer count
  variance_cents        bigint,            -- counted - expected (over = +, short = -)
  cash_payment_count    integer NOT NULL DEFAULT 0,
  status                text NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open','reconciled','discrepancy','cancelled')),
  opened_by_user_id     uuid,
  opened_at             timestamptz,
  reconciled_by_user_id uuid,
  reconciled_at         timestamptz,
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, branch_id, business_date)
);
CREATE INDEX IF NOT EXISTS idx_cash_drawer_tenant_branch_date ON cash_drawer_sessions (tenant_id, branch_id, business_date);
