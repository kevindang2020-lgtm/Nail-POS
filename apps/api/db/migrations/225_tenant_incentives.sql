-- 181_tenant_incentives.sql — Super Admin › Revenue & Residuals › Calculate Tenant Incentives.
-- Idempotent participating-salon incentive calculation over a period (the salon's share of eligible revenue).
-- A unique idempotency_key prevents duplicate incentive payouts. Tenant-scoped (every row carries tenant_id).
-- Money is INTEGER CENTS (BIGINT). Idempotent (IF NOT EXISTS).

create table if not exists tenant_incentives (
  id uuid primary key default gen_random_uuid(),
  agreement_id uuid,
  tenant_id uuid not null,                               -- the participating salon
  branch_id uuid,
  accounting_period_id uuid,
  period_start date not null,
  period_end date not null,
  currency text not null default 'USD',
  eligible_gross_revenue_cents bigint not null default 0,
  salon_pct numeric(6,3),                                -- from the agreement version effective for the period
  incentive_earned_cents bigint not null default 0,      -- decimal-safe salon share of eligible revenue
  refund_allocation_cents bigint not null default 0,     -- salon's proportional share of refunds/credits
  adjustment_allocation_cents bigint not null default 0, -- salon's proportional share of adjustments (signed)
  prior_unpaid_balance_cents bigint not null default 0,
  amount_paid_cents bigint not null default 0,
  current_amount_due_cents bigint not null default 0,    -- earned - refunds + adjustments + prior - paid
  status text not null default 'calculated'
    check (status in ('draft','calculated','pending_approval','approved','paid','reversed','cancelled')),
  idempotency_key text not null,
  calc_snapshot jsonb,
  created_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  check (period_end >= period_start)
);
create unique index if not exists uq_tenant_incentives_idem on tenant_incentives (idempotency_key);
create index if not exists idx_tenant_incentives_tenant on tenant_incentives (tenant_id, period_start desc);
create index if not exists idx_tenant_incentives_agreement on tenant_incentives (agreement_id);
create index if not exists idx_tenant_incentives_status on tenant_incentives (status);
