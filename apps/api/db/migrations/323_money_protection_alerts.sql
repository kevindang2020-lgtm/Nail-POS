-- 323_money_protection_alerts.sql — tenant-isolated financial anomaly alerts for ai_money_protection.
-- This is NOT a payment/refund/audit ledger; it references authoritative records by id and carries a structured
-- evidence package. Non-accusatory by design: `alert_type` describes a possible anomaly, never a person's guilt.
-- Dedup/idempotency: UNIQUE (tenant_id, rule_id, entity_fingerprint, evaluation_window) so re-evaluating the same
-- window never creates duplicate alerts; a repeat instead bumps last_seen_at / event_count.
create table if not exists money_protection_alerts (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null,
  branch_id           uuid,
  rule_id             text not null,
  alert_type          text not null,
  severity            text not null default 'MEDIUM'
                        check (severity in ('INFO','LOW','MEDIUM','HIGH','CRITICAL')),
  status              text not null default 'NEW'
                        check (status in ('NEW','ACKNOWLEDGED','INVESTIGATING','WAITING_FOR_INFORMATION','ESCALATED',
                          'RESOLVED_EXPECTED_ACTIVITY','RESOLVED_SYSTEM_ERROR','RESOLVED_POLICY_VIOLATION',
                          'RESOLVED_CONFIRMED_MISUSE','DISMISSED_FALSE_POSITIVE','CLOSED')),
  risk_score          integer not null default 0,
  confidence          text not null default 'low' check (confidence in ('low','medium','high')),
  amount_cents        bigint not null default 0,            -- value UNDER REVIEW (never "confirmed loss")
  entity_fingerprint  text not null,
  evaluation_window   text not null default '',
  evidence            jsonb not null default '{}'::jsonb,   -- structured evidence package (no card data)
  related             jsonb not null default '{}'::jsonb,   -- {transactionIds, ticketIds, userIds, deviceIds, ...}
  event_count         integer not null default 1,
  first_seen_at       timestamptz not null default now(),
  last_seen_at        timestamptz not null default now(),
  assigned_user_id    uuid,
  investigation_id    uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (tenant_id, rule_id, entity_fingerprint, evaluation_window)
);

create index if not exists idx_mp_alerts_tenant_status_created on money_protection_alerts (tenant_id, status, created_at desc);
create index if not exists idx_mp_alerts_tenant_branch_sev on money_protection_alerts (tenant_id, branch_id, severity, created_at desc);
create index if not exists idx_mp_alerts_tenant_type on money_protection_alerts (tenant_id, alert_type, created_at desc);
