-- 325_money_protection_rule_settings.sql — tenant-configurable detection settings (spec §33/§69/§84).
-- One row per (tenant, rule): whether the rule is enabled for that tenant, an optional severity override, and
-- optional numeric threshold overrides (validated in the service against safe bounds). Absent row = defaults.
-- This never disables the audit trail or changes financial truth — it only tunes what is surfaced for review.
create table if not exists money_protection_rule_settings (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null,
  rule_id            text not null,
  enabled            boolean not null default true,
  severity_override  text
                       check (severity_override is null or severity_override in ('INFO','LOW','MEDIUM','HIGH','CRITICAL')),
  thresholds         jsonb not null default '{}'::jsonb,
  updated_by_user_id uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (tenant_id, rule_id)
);
create index if not exists idx_mp_rule_settings_tenant on money_protection_rule_settings (tenant_id);
