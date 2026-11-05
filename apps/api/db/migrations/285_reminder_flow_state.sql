-- 188_reminder_flow_state.sql — operational status of a reminder flow (§43). A flow is identified by its reminder type
-- (platform-level when tenant_id is null; a tenant may hold its own state row). This is the authoritative gate the
-- scheduler consults before creating new jobs: a 'disabled' / 'paused' / 'under_review' flow stops NEW jobs while all
-- historical delivery records are preserved (this table never deletes attempt history). Disabling requires a reason.
create table if not exists reminder_flow_state (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,                                  -- null = platform-level flow
  reminder_type text not null,
  status text not null default 'active' check (status in ('active','paused','problematic','disabled','under_review','retired')),
  reason text,
  disabled_by uuid,
  disabled_at timestamptz,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create unique index if not exists ux_reminder_flow_state_platform on reminder_flow_state (reminder_type) where tenant_id is null;
create unique index if not exists ux_reminder_flow_state_tenant on reminder_flow_state (tenant_id, reminder_type) where tenant_id is not null;
