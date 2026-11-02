-- 756_ai_front_desk_center.sql — AI Front Desk Complete Build Guide (Oct 31 2026), additive only.
-- Extends the EXISTING agent registry (302 ai_receptionist_agents + its immutable versions) in place; no parallel agent table.
--   • agents: description, config_version (optimistic concurrency), the persisted 8-step wizard (step + per-step state),
--     booking mode (handoff_only | eligible), handoff destination, after-hours message, activation / pause / verification
--     timestamps. A draft is a database row only — saving never calls a provider.
--   • ai_receptionist_agent_events: append-only trail of every agent change (create / save / duplicate / activate / pause /
--     resume / archive / restore / rollback / health) with before/after, reason, actor, idempotency key, config version and,
--     for activation, the PRIOR live agent (the rollback destination). A trigger refuses UPDATE/DELETE.
--   • one LIVE agent per salon route (tenant + branch scope): a partial unique index — two owners racing to activate two
--     agents on the same number cannot both win. Created only when existing data already satisfies it (never rewrites rows).
--   • ai_receptionist_health_runs gains scope + agent_id so "Check AI Front Desk System" / per-agent checks reuse the
--     guide-21 run table (existing rows are scope 'receptionist').
-- Rollback (manual, reverse order):
--   drop index if exists uq_air_agents_one_live; drop table if exists ai_receptionist_agent_events;
--   drop function if exists ai_receptionist_agent_events_append_only();
--   alter table ai_receptionist_health_runs drop column if exists scope, drop column if exists agent_id;
--   alter table ai_receptionist_agents drop column if exists description, drop column if exists config_version,
--     drop column if exists wizard_step, drop column if exists wizard_state, drop column if exists booking_mode,
--     drop column if exists handoff_destination, drop column if exists after_hours_message, drop column if exists activated_at,
--     drop column if exists activated_by, drop column if exists paused_at, drop column if exists last_verified_at;

alter table ai_receptionist_agents add column if not exists description         text;
alter table ai_receptionist_agents add column if not exists config_version      integer not null default 1;
alter table ai_receptionist_agents add column if not exists wizard_step         integer not null default 1;
alter table ai_receptionist_agents add column if not exists wizard_state        jsonb   not null default '{}'::jsonb;
alter table ai_receptionist_agents add column if not exists booking_mode        text    not null default 'handoff_only';
alter table ai_receptionist_agents add column if not exists handoff_destination text;
alter table ai_receptionist_agents add column if not exists after_hours_message text;
alter table ai_receptionist_agents add column if not exists activated_at        timestamptz;
alter table ai_receptionist_agents add column if not exists activated_by        uuid;
alter table ai_receptionist_agents add column if not exists paused_at           timestamptz;
alter table ai_receptionist_agents add column if not exists last_verified_at    timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'chk_air_agents_wizard_step') then
    alter table ai_receptionist_agents add constraint chk_air_agents_wizard_step check (wizard_step between 1 and 8);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chk_air_agents_booking_mode') then
    alter table ai_receptionist_agents add constraint chk_air_agents_booking_mode check (booking_mode in ('handoff_only', 'eligible'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chk_air_agents_config_version') then
    alter table ai_receptionist_agents add constraint chk_air_agents_config_version check (config_version >= 1);
  end if;
end $$;

create index if not exists idx_air_agents_tenant_created_id on ai_receptionist_agents (tenant_id, created_at desc, id desc);
create index if not exists idx_air_agents_provider_ref on ai_receptionist_agents (provider_agent_id) where provider_agent_id is not null;

-- one live agent per salon route; only when today's data already satisfies it (a duplicate is reported by the health check)
do $$ begin
  if not exists (
    select 1 from ai_receptionist_agents where status = 'live'
    group by tenant_id, coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid) having count(*) > 1
  ) then
    create unique index if not exists uq_air_agents_one_live on ai_receptionist_agents
      (tenant_id, coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)) where status = 'live';
  end if;
end $$;

create table if not exists ai_receptionist_agent_events (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id),
  branch_id        uuid,
  agent_id         uuid not null,
  action           text not null check (action in ('created', 'saved', 'duplicated', 'activated', 'paused', 'resumed', 'archived', 'restored', 'rolled_back', 'health_checked', 'demoted')),
  before_state     jsonb not null default '{}'::jsonb,
  after_state      jsonb not null default '{}'::jsonb,
  reason           text,
  config_version   integer,
  prior_agent_id   uuid,
  operation_id     uuid,
  actor_user_id    uuid,
  idempotency_key  text,
  created_at       timestamptz not null default clock_timestamp()
);
create unique index if not exists uq_air_agent_events_idem on ai_receptionist_agent_events (tenant_id, idempotency_key) where idempotency_key is not null;
create index if not exists idx_air_agent_events_agent on ai_receptionist_agent_events (tenant_id, agent_id, created_at desc, id desc);
create index if not exists idx_air_agent_events_recent on ai_receptionist_agent_events (tenant_id, created_at desc, id desc);
create or replace function ai_receptionist_agent_events_append_only() returns trigger language plpgsql as $$
begin raise exception 'ai_receptionist_agent_events is append-only'; end $$;
drop trigger if exists trg_air_agent_events_append_only on ai_receptionist_agent_events;
create trigger trg_air_agent_events_append_only before update or delete on ai_receptionist_agent_events
  for each row execute function ai_receptionist_agent_events_append_only();

alter table ai_receptionist_health_runs add column if not exists scope    text not null default 'receptionist';
alter table ai_receptionist_health_runs add column if not exists agent_id uuid;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'chk_ai_rcpt_health_runs_scope') then
    alter table ai_receptionist_health_runs add constraint chk_ai_rcpt_health_runs_scope check (scope in ('receptionist', 'front_desk', 'agent'));
  end if;
end $$;
create index if not exists idx_ai_rcpt_health_runs_scope on ai_receptionist_health_runs (tenant_id, scope, created_at desc, id desc);
