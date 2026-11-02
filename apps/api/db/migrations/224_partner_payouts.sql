-- 180_partner_payouts.sql — Super Admin › Revenue & Residuals › Calculate Partner Payouts.
-- Idempotent partner/processor payout calculation over a period. A unique idempotency_key prevents duplicate
-- payouts (re-calculating the same partner+agreement+period returns the existing row). The calculation snapshot is
-- preserved. Money is INTEGER CENTS (BIGINT). Idempotent (IF NOT EXISTS).

create table if not exists partner_payouts (
  id uuid primary key default gen_random_uuid(),
  agreement_id uuid,
  processor text not null,                               -- the partner/processor being paid
  accounting_period_id uuid,
  period_start date not null,
  period_end date not null,
  tenant_id uuid,
  branch_id uuid,
  currency text not null default 'USD',
  eligible_revenue_cents bigint not null default 0,      -- residual base for the period
  partner_pct numeric(6,3),                              -- from the agreement version effective for the period
  partner_gross_share_cents bigint not null default 0,   -- decimal-safe share of eligible revenue
  refund_allocation_cents bigint not null default 0,     -- partner's proportional share of refunds/credits
  adjustment_allocation_cents bigint not null default 0, -- partner's proportional share of adjustments (signed)
  prior_balance_cents bigint not null default 0,
  amount_paid_cents bigint not null default 0,
  amount_due_cents bigint not null default 0,            -- gross - refunds + adjustments + prior - paid
  payout_date date,
  status text not null default 'calculated'
    check (status in ('draft','calculated','pending_approval','approved','scheduled','processing','paid','failed','reversed','cancelled')),
  payment_reference text,
  idempotency_key text not null,
  calc_snapshot jsonb,
  created_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  check (period_end >= period_start)
);
create unique index if not exists uq_partner_payouts_idem on partner_payouts (idempotency_key);
create index if not exists idx_partner_payouts_processor on partner_payouts (processor, period_start desc);
create index if not exists idx_partner_payouts_agreement on partner_payouts (agreement_id);
create index if not exists idx_partner_payouts_status on partner_payouts (status);
