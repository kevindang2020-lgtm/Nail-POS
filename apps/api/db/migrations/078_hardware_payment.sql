-- 078_hardware_payment.sql — Hardware Payment Recovery (build doc §13). Integer cents + bps. References existing
-- hardware_packages(id). Tenant-scoped; global default split settings have tenant_id NULL.
CREATE TABLE IF NOT EXISTS hardware_payment_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  branch_id UUID,
  hardware_package_id UUID,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','paused','paid_off','defaulted','cancelled','closed')),
  total_hardware_cost_cents BIGINT NOT NULL DEFAULT 0,
  down_payment_cents BIGINT NOT NULL DEFAULT 0,
  financed_amount_cents BIGINT NOT NULL DEFAULT 0,
  monthly_payment_cents BIGINT NOT NULL DEFAULT 0,
  remaining_balance_cents BIGINT NOT NULL DEFAULT 0,
  start_date DATE, end_date DATE, due_day_of_month INT NOT NULL DEFAULT 1,
  revenue_split_recovery_enabled BOOLEAN NOT NULL DEFAULT true,
  auto_charge_shortfall_enabled BOOLEAN NOT NULL DEFAULT true,
  extra_credit_handling TEXT NOT NULL DEFAULT 'cap_at_monthly_due' CHECK (extra_credit_handling IN ('cap_at_monthly_due','carry_forward_next_month','apply_to_principal_balance')),
  carry_forward_credit_cents BIGINT NOT NULL DEFAULT 0,
  saved_payment_method_id UUID,
  created_by_user_id UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), closed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_hw_plans_tenant ON hardware_payment_plans(tenant_id);

CREATE TABLE IF NOT EXISTS hardware_revenue_split_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,                                   -- NULL = global default
  hardware_payment_plan_id UUID,
  pricing_rate_bps INT NOT NULL DEFAULT 300,
  expense_rate_bps INT NOT NULL DEFAULT 180,
  net_margin_bps INT NOT NULL DEFAULT 120,
  platform_share_percent INT NOT NULL DEFAULT 65,
  fiserv_share_percent INT NOT NULL DEFAULT 35,
  salon_hardware_credit_percent_of_platform_share INT NOT NULL DEFAULT 25,
  effective_start_date DATE, effective_end_date DATE,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_by_user_id UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (pricing_rate_bps >= expense_rate_bps),
  CHECK (platform_share_percent + fiserv_share_percent = 100),
  CHECK (salon_hardware_credit_percent_of_platform_share BETWEEN 0 AND 100)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_hw_split_global_default ON hardware_revenue_split_settings((1)) WHERE tenant_id IS NULL AND is_default;
CREATE INDEX IF NOT EXISTS idx_hw_split_tenant ON hardware_revenue_split_settings(tenant_id);

CREATE TABLE IF NOT EXISTS hardware_payment_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  hardware_payment_plan_id UUID NOT NULL,
  billing_month TEXT NOT NULL,                      -- 'YYYY-MM'
  card_volume_cents BIGINT NOT NULL DEFAULT 0,
  pricing_rate_bps INT NOT NULL, expense_rate_bps INT NOT NULL,
  net_margin_cents BIGINT NOT NULL DEFAULT 0,
  platform_share_cents BIGINT NOT NULL DEFAULT 0,
  fiserv_share_cents BIGINT NOT NULL DEFAULT 0,
  salon_hardware_credit_cents BIGINT NOT NULL DEFAULT 0,
  hardware_monthly_due_cents BIGINT NOT NULL DEFAULT 0,
  carry_forward_credit_cents BIGINT NOT NULL DEFAULT 0,
  shortfall_cents BIGINT NOT NULL DEFAULT 0,
  auto_charge_amount_cents BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','credit_applied','shortfall_pending','auto_charge_processing','paid','payment_failed','payment_method_required','past_due','voided','cancelled')),
  due_date DATE, paid_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (hardware_payment_plan_id, billing_month)
);
CREATE INDEX IF NOT EXISTS idx_hw_invoices_tenant ON hardware_payment_invoices(tenant_id);

CREATE TABLE IF NOT EXISTS hardware_payment_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  hardware_payment_plan_id UUID NOT NULL,
  invoice_id UUID,
  entry_type TEXT NOT NULL,
  amount_cents BIGINT NOT NULL,
  description TEXT, source TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by_user_id UUID
);
CREATE INDEX IF NOT EXISTS idx_hw_ledger_invoice ON hardware_payment_ledger(invoice_id);
CREATE INDEX IF NOT EXISTS idx_hw_ledger_tenant ON hardware_payment_ledger(tenant_id);

CREATE TABLE IF NOT EXISTS hardware_payment_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  gateway_customer_id TEXT, gateway_payment_method_token TEXT NOT NULL,   -- tokenized only; NEVER raw PAN/CVV
  brand TEXT, last4 TEXT, exp_month INT, exp_year INT, billing_zip TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','removed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hw_methods_tenant ON hardware_payment_methods(tenant_id);

CREATE TABLE IF NOT EXISTS hardware_autopay_consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  hardware_payment_plan_id UUID,
  authorized_by_user_id UUID NOT NULL,
  authorized_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip_address TEXT, device_info TEXT, consent_text_version TEXT NOT NULL DEFAULT 'v1',
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_hw_consents_tenant ON hardware_autopay_consents(tenant_id);

CREATE TABLE IF NOT EXISTS hardware_payment_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  hardware_payment_plan_id UUID NOT NULL,
  invoice_id UUID,
  amount_cents BIGINT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('processing','succeeded','failed','voided','refunded')),
  gateway_retref TEXT, gateway_resp_status TEXT, gateway_resp_text TEXT,
  attempt INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hw_txn_invoice ON hardware_payment_transactions(invoice_id);

CREATE TABLE IF NOT EXISTS hardware_reconciliation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,                                  -- NULL = a multi-tenant run
  billing_month TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('running','completed','failed','partial')),
  plans_processed INT NOT NULL DEFAULT 0, invoices_created INT NOT NULL DEFAULT 0,
  shortfalls_charged_cents BIGINT NOT NULL DEFAULT 0, failures INT NOT NULL DEFAULT 0,
  notes TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
