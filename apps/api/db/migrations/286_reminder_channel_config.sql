-- 189_reminder_channel_config.sql — channel + fallback configuration per reminder type (§35, §36). Platform-level when
-- tenant_id is null; tenant override otherwise. The backend (not the frontend) decides the valid channel sequence:
-- primary first, then the ordered fallback list. Fallback behavior is governed by when to fall back, the max fallback
-- attempts, stop-on-success (never send twice once delivered), and suppression / quiet-hour re-checks before each hop.
create table if not exists reminder_channel_config (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,                                  -- null = platform default
  reminder_type text not null,
  primary_channel text not null check (primary_channel in ('sms','email','push')),
  fallback_channels text[] not null default '{}',
  fallback_on text not null default 'temporary_failure' check (fallback_on in ('temporary_failure','timeout','any_failure')),
  max_fallback_attempts int not null default 1 check (max_fallback_attempts between 0 and 10),
  stop_on_success boolean not null default true,
  recheck_suppression boolean not null default true,
  recheck_quiet_hours boolean not null default true,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create unique index if not exists ux_reminder_channel_platform on reminder_channel_config (reminder_type) where tenant_id is null;
create unique index if not exists ux_reminder_channel_tenant on reminder_channel_config (tenant_id, reminder_type) where tenant_id is not null;
