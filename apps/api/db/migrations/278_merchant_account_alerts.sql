-- 180_merchant_account_alerts.sql — operational alerts for Merchant Accounts (§36). Each alert carries only a safe
-- summary (never sensitive banking/processor detail). The Merchant Account Alerts module shows OPEN/active alerts
-- (anything not resolved/closed). Alerts are tenant-scoped and drive the module's count + list.

create table if not exists merchant_account_alerts (
  id                       uuid primary key default gen_random_uuid(),
  tenant_id                uuid not null,
  merchant_id              text,
  alert_type               text not null,
  severity                 text not null default 'warning'
    check (severity in ('info','warning','critical')),
  summary                  text not null,
  status                   text not null default 'open'
    check (status in ('open','acknowledged','investigating','waiting_for_tenant','waiting_for_processor','resolved','closed')),
  assigned_reviewer_user_id uuid,
  assigned_reviewer_name   text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  resolved_at              timestamptz
);

create index if not exists idx_merchant_account_alerts_tenant_status
  on merchant_account_alerts (tenant_id, status, created_at desc);
