-- 115_payroll.sql — payroll runs / commission ledger (Team payroll, T11 / Payments & Money, T13). A payroll_period is a
-- pay run over a date range; payroll_lines are per-technician summaries (services, gross sales, commission, tips,
-- adjustments → payable). This is the PERSISTED payroll/commission aggregation layer; per-line real-time commission for
-- tech dashboards is computed elsewhere and is unchanged. Lifecycle: draft → finalized → paid. Integer cents throughout.
-- Tenant/branch scoped. Additive + idempotent.
CREATE TABLE IF NOT EXISTS payroll_periods (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL,
  branch_id              UUID,
  label                  TEXT,
  period_start           DATE NOT NULL,
  period_end             DATE NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'draft',   -- draft | finalized | paid
  finalized_at           TIMESTAMPTZ,
  paid_at                TIMESTAMPTZ,
  total_gross_cents      BIGINT NOT NULL DEFAULT 0,
  total_commission_cents BIGINT NOT NULL DEFAULT 0,
  total_tips_cents       BIGINT NOT NULL DEFAULT 0,
  total_payable_cents    BIGINT NOT NULL DEFAULT 0,
  created_by             UUID,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payroll_periods_tenant_status ON payroll_periods (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_payroll_periods_tenant_range  ON payroll_periods (tenant_id, period_start DESC);

CREATE TABLE IF NOT EXISTS payroll_lines (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  period_id         UUID NOT NULL,
  technician_id     UUID NOT NULL,
  technician_name   TEXT,
  services_count    INTEGER NOT NULL DEFAULT 0,
  gross_sales_cents BIGINT NOT NULL DEFAULT 0,
  commission_type   TEXT NOT NULL DEFAULT 'percent',   -- percent | flat
  commission_value  NUMERIC NOT NULL DEFAULT 0,        -- percent (e.g. 50) or flat cents-per-service
  commission_cents  BIGINT NOT NULL DEFAULT 0,
  tips_cents        BIGINT NOT NULL DEFAULT 0,
  adjustment_cents  BIGINT NOT NULL DEFAULT 0,
  payable_cents     BIGINT NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payroll_lines_period_tech ON payroll_lines (period_id, technician_id);
CREATE INDEX IF NOT EXISTS idx_payroll_lines_tenant ON payroll_lines (tenant_id);
