-- 182_revenue_adjustments.sql — Super Admin › Revenue & Residuals › Approve Revenue Adjustments.
-- Adjustments NEVER edit original revenue; on approval a SEPARATE ledger entry (a revenue_records row of source
-- 'adjustment') is created and linked back. Approval is required; high-value adjustments require DUAL approval by
-- two distinct actors. Adjustments to a LOCKED accounting period are blocked. Money is INTEGER CENTS (signed).

create table if not exists revenue_adjustments (
  id uuid primary key default gen_random_uuid(),
  adjustment_ref text not null unique,                   -- ADJ-YYYY-####
  agreement_id uuid,
  revenue_record_id uuid,                                -- the record being adjusted (original is preserved)
  accounting_period_id uuid,
  tenant_id uuid,
  branch_id uuid,
  processor text,
  adjustment_type text not null
    check (adjustment_type in ('processor_correction','refund_correction','credit','billing_correction','reclassification','partner_share_correction','tenant_incentive_correction','rounding_correction','prior_period','write_off','other')),
  amount_cents bigint not null,                          -- signed (may be negative)
  direction text not null check (direction in ('increase','decrease')),
  reason text not null,
  supporting_evidence text,
  requires_dual_approval boolean not null default false,
  requested_by uuid,
  approved_by uuid,
  second_approved_by uuid,
  status text not null default 'pending_approval'
    check (status in ('draft','pending_approval','pending_second_approval','applied','rejected','reversed')),
  ledger_record_id uuid,                                 -- the separate revenue_records entry created on apply
  rejected_reason text,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  applied_at timestamptz
);
create index if not exists idx_rev_adj_record on revenue_adjustments (revenue_record_id);
create index if not exists idx_rev_adj_agreement on revenue_adjustments (agreement_id);
create index if not exists idx_rev_adj_status on revenue_adjustments (status);
create index if not exists idx_rev_adj_period on revenue_adjustments (accounting_period_id);
