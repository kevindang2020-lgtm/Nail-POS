-- 056_expenses.sql — operating expenses recorded by owners (rent, supplies, utilities, marketing, …). Feed real net
-- profit (revenue − commission − expenses). Branch-scoped; incurred_on is the salon-local date (like appt_date).
CREATE TABLE IF NOT EXISTS expenses (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL,
  branch_id    UUID,
  category     TEXT NOT NULL,
  amount_cents BIGINT NOT NULL CHECK (amount_cents >= 0),
  description  TEXT,
  vendor       TEXT,
  incurred_on  DATE NOT NULL,
  created_by   UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_expenses_tenant_date ON expenses (tenant_id, incurred_on DESC);
