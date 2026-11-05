-- 186_reminder_timing_defaults.sql — default timing configuration per reminder type (§34). A platform default has
-- tenant_id null; a tenant may hold an override row per type. Offset is stored as a direction + magnitude, with an
-- allowed [min,max] band the backend enforces (tenant customizations and job scheduling must stay inside it). Quiet
-- hours are minutes-of-day (0..1439); timezone_source decides whose clock the local send time is computed in.
create table if not exists reminder_timing_defaults (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,                                  -- null = platform default
  reminder_type text not null,
  direction text not null default 'before' check (direction in ('before','after','immediate')),
  offset_minutes int not null default 0 check (offset_minutes >= 0),
  min_offset_minutes int not null default 0 check (min_offset_minutes >= 0),
  max_offset_minutes int not null default 10080 check (max_offset_minutes >= 0), -- 7 days
  quiet_hours_start int check (quiet_hours_start is null or (quiet_hours_start between 0 and 1439)),
  quiet_hours_end int check (quiet_hours_end is null or (quiet_hours_end between 0 and 1439)),
  quiet_hours_policy text not null default 'defer' check (quiet_hours_policy in ('defer','skip','send')),
  timezone_source text not null default 'tenant' check (timezone_source in ('tenant','branch','customer')),
  enabled boolean not null default true,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (min_offset_minutes <= max_offset_minutes)
);
-- One platform default per type; one override per tenant per type.
create unique index if not exists ux_reminder_timing_platform on reminder_timing_defaults (reminder_type) where tenant_id is null;
create unique index if not exists ux_reminder_timing_tenant on reminder_timing_defaults (tenant_id, reminder_type) where tenant_id is not null;
