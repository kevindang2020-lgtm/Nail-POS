-- 084_cash_drawer_movements.sql — mid-shift cash in/out for the front-desk register drawer.
-- Paid-in (e.g. adding change/float) and paid-out (e.g. petty-cash payout, cash drop to safe) adjust the expected
-- drawer total: expected = opening float + cash sales - cash refunds + paid-in - paid-out.
CREATE TABLE IF NOT EXISTS cash_drawer_movements (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL,
  branch_id           uuid NOT NULL,
  business_date       date NOT NULL,
  direction           text NOT NULL CHECK (direction IN ('in','out')),
  amount_cents        bigint NOT NULL CHECK (amount_cents > 0),
  reason              text,            -- short category, e.g. petty_cash / cash_drop / float_add / payout / correction
  note                text,
  created_by_user_id  uuid,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cash_drawer_mov ON cash_drawer_movements (tenant_id, branch_id, business_date);
