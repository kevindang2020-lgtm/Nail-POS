-- 187_reminder_tenant_overrides.sql — tenant customization of reminders (§42). Overrides are stored SEPARATELY from
-- platform defaults (never mutating them), one row per (tenant_id, reminder_type). A null override field means "inherit
-- the platform default". The backend enforces that a timing override stays inside the platform's allowed [min,max] band
-- and that channel overrides are a subset of the supported channels — tenants cannot bypass platform limits or hard
-- rules. Reverting deletes the override row so the effective config falls back to the platform default. History is
-- preserved via audit_events (before/after).
create table if not exists reminder_tenant_overrides (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  reminder_type text not null,
  enabled boolean not null default true,
  direction text check (direction is null or direction in ('before','after','immediate')),
  offset_minutes int check (offset_minutes is null or offset_minutes >= 0),
  channels text[],                                 -- null = inherit; subset of supported channels when set
  quiet_hours_policy text check (quiet_hours_policy is null or quiet_hours_policy in ('defer','skip','send')),
  approval_state text not null default 'approved' check (approval_state in ('pending','approved','rejected')),
  effective_date timestamptz,
  end_date timestamptz,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (tenant_id, reminder_type)
);
create index if not exists ix_reminder_tenant_overrides on reminder_tenant_overrides (tenant_id, reminder_type);
