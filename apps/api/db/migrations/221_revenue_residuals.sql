-- 177_revenue_residuals.sql — Super Admin › Payments & Revenue › Revenue & Residuals.
-- Platform revenue-sharing / residual / payout / accounting-period domain. Money is INTEGER CENTS (BIGINT).
-- Three-way split terms are VERSIONED (immutable per version) and selected by the revenue-event date.
-- Idempotent (IF NOT EXISTS). No processor credentials / bank details / card data are stored here.

-- ── Agreements (header; points at the current version) ──
create table if not exists revenue_agreements (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,                              -- e.g. AGR-2026-0010
  name text not null,
  agreement_type text,                                   -- residual | subscription | partner | custom
  tenant_id uuid,                                        -- null = platform-wide
  branch_id uuid,                                        -- null = all branches in scope
  processor text,                                        -- fiserv | stripe | square | adyen | global_payments | ...
  revenue_source text,                                   -- processing_residual | subscription | add_on | ...
  current_version_id uuid,                               -- FK added after versions table exists
  status text not null default 'draft'
    check (status in ('draft','pending_approval','active','suspended','expired','terminated','replaced')),
  created_by uuid,
  approved_by uuid,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  updated_at timestamptz not null default now()
);

-- ── Immutable versioned terms (three-way split % + effective window + policies) ──
create table if not exists revenue_agreement_versions (
  id uuid primary key default gen_random_uuid(),
  agreement_id uuid not null references revenue_agreements(id),
  version_number int not null,
  ai_powersalon_pct numeric(6,3) not null,               -- e.g. 60.000
  processor_pct numeric(6,3) not null,                   -- e.g. 15.000
  salon_pct numeric(6,3) not null,                       -- e.g. 25.000
  effective_date date not null,
  expiration_date date,                                  -- null = open-ended
  currency text not null default 'USD',
  rounding_policy text not null default 'largest_remainder',   -- how the leftover cent is allocated
  refund_allocation text not null default 'ai_powersalon',     -- who absorbs refunds/credits for net revenue
  minimum_volume_cents bigint,
  maximum_volume_cents bigint,
  change_reason text,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (agreement_id, version_number),
  check (ai_powersalon_pct >= 0 and processor_pct >= 0 and salon_pct >= 0),
  check (ai_powersalon_pct + processor_pct + salon_pct = 100),
  check (expiration_date is null or expiration_date >= effective_date)
);

-- ── Accounting periods (lockable) ──
create table if not exists revenue_accounting_periods (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,                             -- e.g. 2026-05
  start_date date not null,
  end_date date not null,
  currency text not null default 'USD',
  status text not null default 'open'
    check (status in ('open','review','reconciled','ready_to_lock','locked','reopened')),
  locked_by uuid,
  locked_at timestamptz,
  lock_reason text,
  reopened_by uuid,
  reopened_at timestamptz,
  reopen_reason text,
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);

-- ── Revenue records (the table rows; split shares stored in integer cents) ──
create table if not exists revenue_records (
  id uuid primary key default gen_random_uuid(),
  agreement_id uuid references revenue_agreements(id),
  agreement_version_id uuid references revenue_agreement_versions(id),   -- historical link (never re-pointed)
  tenant_id uuid,
  branch_id uuid,
  processor text,
  revenue_source text,
  source_reference text,
  accounting_period_id uuid references revenue_accounting_periods(id),
  currency text not null default 'USD',
  gross_revenue_cents bigint not null default 0,
  -- split snapshot (from the version used at calculation time)
  ai_powersalon_pct numeric(6,3),
  processor_pct numeric(6,3),
  salon_pct numeric(6,3),
  -- allocated shares (decimal-safe, reconcile to distributable total)
  ai_powersalon_share_cents bigint not null default 0,
  processor_share_cents bigint not null default 0,
  salon_incentive_share_cents bigint not null default 0,
  refunds_credits_cents bigint not null default 0,       -- stored as a positive magnitude; deducted in net
  adjustments_cents bigint not null default 0,
  rounding_adjustment_cents bigint not null default 0,
  net_revenue_cents bigint not null default 0,           -- AI PowerSalon net after allocated refunds/credits/adjustments
  outstanding_balance_cents bigint not null default 0,
  forecasted_revenue_cents bigint not null default 0,
  effective_date date,
  status text not null default 'draft'
    check (status in ('draft','pending','calculated','reconciliation_required','reconciled','approved','payable','paid','partially_paid','overdue','disputed','adjusted','locked','cancelled')),
  calculated_at timestamptz,
  approved_at timestamptz,
  paid_at timestamptz,
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Immutable audit trail ──
create table if not exists revenue_audit_log (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  agreement_id uuid,
  agreement_version_id uuid,
  revenue_record_id uuid,
  tenant_id uuid,
  branch_id uuid,
  accounting_period_id uuid,
  processor text,
  actor_id uuid,
  actor_role text,
  field text,
  old_value text,
  new_value text,
  reason text,
  correlation_id text,
  created_at timestamptz not null default now()
);

-- indexes
create index if not exists idx_rev_records_agreement on revenue_records (agreement_id);
create index if not exists idx_rev_records_version on revenue_records (agreement_version_id);
create index if not exists idx_rev_records_tenant on revenue_records (tenant_id);
create index if not exists idx_rev_records_branch on revenue_records (branch_id);
create index if not exists idx_rev_records_processor on revenue_records (processor);
create index if not exists idx_rev_records_source on revenue_records (revenue_source);
create index if not exists idx_rev_records_period on revenue_records (accounting_period_id);
create index if not exists idx_rev_records_effective on revenue_records (effective_date desc);
create index if not exists idx_rev_records_status on revenue_records (status);
create index if not exists idx_rev_records_created on revenue_records (created_at desc);
create index if not exists idx_rev_agr_versions_tpl on revenue_agreement_versions (agreement_id, effective_date desc);
create index if not exists idx_rev_audit_agreement on revenue_audit_log (agreement_id, created_at desc);
create index if not exists idx_rev_audit_record on revenue_audit_log (revenue_record_id, created_at desc);
