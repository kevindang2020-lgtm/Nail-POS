-- 177_merchant_rate_schedules.sql — structured, decimal-safe processing-rate configuration for Merchant Accounts.
-- Rates are NEVER stored as a mutable display string; the authoritative values are integers (basis points + minor
-- units). Schedules are append-only and effective-dated so history is preserved (a new effective row supersedes the
-- prior one — prior rows are retained, never overwritten). The "active" rate for a merchant is the approved/active
-- schedule with the greatest effective_at that is currently in force. Pricing plans are platform-level templates.

create table if not exists merchant_pricing_plans (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique,
  name        text not null,
  description text,
  sort        int not null default 0,
  created_at  timestamptz not null default now()
);

create table if not exists merchant_rate_schedules (
  id                       uuid primary key default gen_random_uuid(),
  tenant_id                uuid not null,
  pricing_plan_id          uuid references merchant_pricing_plans(id),
  percentage_basis_points  int  not null check (percentage_basis_points >= 0 and percentage_basis_points <= 100000),
  per_txn_fee_minor        int  not null default 0 check (per_txn_fee_minor >= 0),
  monthly_fee_minor        int  not null default 0 check (monthly_fee_minor >= 0),
  refund_fee_minor         int  not null default 0 check (refund_fee_minor >= 0),
  chargeback_fee_minor     int  not null default 0 check (chargeback_fee_minor >= 0),
  currency                 text not null default 'usd',
  effective_at             timestamptz not null,
  expires_at               timestamptz,
  status                   text not null default 'draft'
    check (status in ('draft','pending','approved','active','superseded','expired')),
  change_reason            text,
  approved_by              uuid,
  created_by               uuid,
  created_at               timestamptz not null default now()
);

-- Active-rate lookup: filter by tenant + in-force schedules, order by effective_at desc.
create index if not exists idx_merchant_rate_schedules_tenant_effective
  on merchant_rate_schedules (tenant_id, effective_at desc);
create index if not exists idx_merchant_rate_schedules_status
  on merchant_rate_schedules (tenant_id, status);
