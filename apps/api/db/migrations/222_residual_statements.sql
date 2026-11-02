-- 178_residual_statements.sql — Super Admin › Revenue & Residuals › Review Residual Statements.
-- Processor residual statements + their line items. Import is IDEMPOTENT (dedupe on import_hash) and the original
-- statement is PRESERVED (no destructive re-import). Money is INTEGER CENTS (BIGINT). Idempotent (IF NOT EXISTS).

create table if not exists residual_statements (
  id uuid primary key default gen_random_uuid(),
  processor text not null,
  statement_ref text not null,                           -- the processor's statement number
  merchant_account text,
  tenant_id uuid,
  branch_id uuid,
  period_start date not null,
  period_end date not null,
  currency text not null default 'USD',
  transaction_volume_cents bigint not null default 0,
  eligible_revenue_cents bigint not null default 0,
  processing_residual_cents bigint not null default 0,   -- processor-reported residual
  fees_cents bigint not null default 0,
  refunds_cents bigint not null default 0,
  chargebacks_cents bigint not null default 0,
  adjustments_cents bigint not null default 0,
  processor_calculated_cents bigint not null default 0,  -- amount the processor says is owed
  import_hash text not null,                             -- dedupe key (processor|ref|period|amount)
  source_file text,
  import_status text not null default 'imported'
    check (import_status in ('imported','failed','reversed')),
  review_status text not null default 'pending'
    check (review_status in ('pending','in_review','reviewed','flagged','reconciled')),
  review_notes text,
  unmatched_lines int not null default 0,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  check (period_end >= period_start)
);

-- one statement per identical (processor + ref + period + amount) → blocks duplicate imports
create unique index if not exists uq_residual_statements_hash on residual_statements (import_hash);
create index if not exists idx_residual_stmt_processor on residual_statements (processor, period_start desc);
create index if not exists idx_residual_stmt_tenant on residual_statements (tenant_id);
create index if not exists idx_residual_stmt_review on residual_statements (review_status);

create table if not exists residual_statement_lines (
  id uuid primary key default gen_random_uuid(),
  statement_id uuid not null references residual_statements(id),
  merchant_account text,
  tenant_id uuid,
  branch_id uuid,
  gross_volume_cents bigint not null default 0,
  eligible_revenue_cents bigint not null default 0,
  residual_cents bigint not null default 0,
  matched boolean not null default false,                -- linked to an active agreement for the scope+period
  agreement_id uuid,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists idx_residual_lines_stmt on residual_statement_lines (statement_id);
create index if not exists idx_residual_lines_tenant on residual_statement_lines (tenant_id);
