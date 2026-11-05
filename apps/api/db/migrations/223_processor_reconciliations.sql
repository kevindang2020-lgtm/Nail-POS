-- 179_processor_reconciliations.sql — Super Admin › Revenue & Residuals › Reconcile Processor Reports.
-- A reconciliation is a COMPARISON record (never mutates the source statement): it checks the processor-reported
-- residual header against the sum of the statement's line residuals, and stores the agreement-derived three-way
-- split of the residual for transparency. Money is INTEGER CENTS (BIGINT). Idempotent (IF NOT EXISTS).

create table if not exists processor_reconciliations (
  id uuid primary key default gen_random_uuid(),
  statement_id uuid not null references residual_statements(id),
  agreement_id uuid,                                     -- matched agreement used for the expected split
  tenant_id uuid,
  branch_id uuid,
  processor text,
  period_start date,
  period_end date,
  currency text not null default 'USD',
  expected_amount_cents bigint not null default 0,       -- sum of line residuals (detailed truth)
  actual_amount_cents bigint not null default 0,         -- statement header residual (processor summary)
  difference_cents bigint not null default 0,            -- actual - expected
  difference_type text not null default 'match'
    check (difference_type in ('match','processor_over','processor_under','no_lines')),
  expected_ai_cents bigint not null default 0,           -- agreement split of the residual (reference)
  expected_processor_cents bigint not null default 0,
  expected_salon_cents bigint not null default 0,
  status text not null default 'matched'
    check (status in ('matched','variance','resolved')),
  reviewer uuid,
  notes text,
  resolution text,
  created_at timestamptz not null default now()
);
create index if not exists idx_reconciliations_stmt on processor_reconciliations (statement_id, created_at desc);
create index if not exists idx_reconciliations_status on processor_reconciliations (status);
create index if not exists idx_reconciliations_tenant on processor_reconciliations (tenant_id);
