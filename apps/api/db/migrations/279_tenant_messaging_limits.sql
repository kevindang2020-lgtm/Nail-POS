-- 182_tenant_messaging_limits.sql — per-tenant messaging usage limits (§36). One active limit configuration per tenant
-- (upsert; change history is preserved in audit_events with before/after). Null monthly/daily values mean "unlimited"
-- for that channel. Enforcement is backend-authoritative: the send pipeline calls the limits evaluator before dispatch
-- (soft = warn, hard = block, approval = require manual approval). This is not a frontend-only guard.
create table if not exists tenant_messaging_limits (
  tenant_id uuid primary key,
  monthly_sms int check (monthly_sms is null or monthly_sms >= 0),
  monthly_email int check (monthly_email is null or monthly_email >= 0),
  monthly_push int check (monthly_push is null or monthly_push >= 0),
  daily_limit int check (daily_limit is null or daily_limit >= 0),
  enforcement text not null default 'soft' check (enforcement in ('soft','hard','approval')),
  opt_out_rate_threshold_bps int check (opt_out_rate_threshold_bps is null or (opt_out_rate_threshold_bps between 0 and 10000)),
  failure_rate_threshold_bps int check (failure_rate_threshold_bps is null or (failure_rate_threshold_bps between 0 and 10000)),
  status text not null default 'active' check (status in ('active','suspended')),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
