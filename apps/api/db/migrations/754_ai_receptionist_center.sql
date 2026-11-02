-- 754_ai_receptionist_center.sql — AI Receptionist Complete Build & Repair Guide (Oct 31 2026), additive only.
--
-- Why: the photographed page showed Twilio "Connected", Retell "Not connected", "Integration key: Not issued" and
-- "Booking actions: Handoff-only". Root cause (code, not guesswork):
--   • "Connected" came from resolveTelephonyProvider(process.env): the PLATFORM's TWILIO_ACCOUNT_SID/TOKEN existing.
--     That is not the salon's account and proves nothing about a number routed to a voice agent.
--   • Retell "Not connected" = RETELL_API_KEY absent; when present it was shown "connected" from presence alone.
--   • "Not issued" = no un-revoked row in voice_integration_keys for the tenant.
--   • "Handoff-only" = the PROCESS-WIDE env switch VOICE_WRITE_TOOLS_ENABLED was off — there was no per-salon control.
-- This migration adds the per-salon operational control (booking actions armed / verified test call / activation), an
-- append-only record of every change to it, read-only health-check runs, and the approval-gated action record used by the
-- priority worklist. Nothing here stores a provider secret.
--
-- Rollback (reverse order; no existing table is altered destructively):
--   drop table if exists ai_receptionist_actions; drop table if exists ai_receptionist_health_runs;
--   drop table if exists ai_receptionist_control_events; drop table if exists ai_receptionist_control;
--   drop index if exists idx_vco_tenant_started; drop index if exists idx_vco_tenant_created;

create table if not exists ai_receptionist_control (
  id                        uuid primary key default gen_random_uuid(),
  tenant_id                 uuid not null references tenants(id),
  branch_id                 uuid references branches(id),
  booking_armed             boolean not null default false,
  booking_armed_at          timestamptz,
  booking_armed_by          uuid,
  booking_arm_reason        text,
  test_call_provider_call_id text,
  test_call_verified_at     timestamptz,
  test_call_verified_by     uuid,
  activated                 boolean not null default false,
  activated_at              timestamptz,
  activated_by              uuid,
  version                   integer not null default 1,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  updated_by                uuid
);
create unique index if not exists uq_ai_rcpt_control_scope on ai_receptionist_control (tenant_id, coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- append-only: who changed a protected setting, before/after, why (guide §15)
create table if not exists ai_receptionist_control_events (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id),
  branch_id        uuid,
  action           text not null check (action in ('arm_booking', 'disarm_booking', 'verify_test_call', 'clear_test_call', 'activate', 'deactivate')),
  before_state     jsonb not null default '{}'::jsonb,
  after_state      jsonb not null default '{}'::jsonb,
  reason           text,
  actor_user_id    uuid,
  idempotency_key  text,
  created_at       timestamptz not null default clock_timestamp()
);
create unique index if not exists uq_ai_rcpt_control_events_idem on ai_receptionist_control_events (tenant_id, idempotency_key) where idempotency_key is not null;
create index if not exists idx_ai_rcpt_control_events on ai_receptionist_control_events (tenant_id, created_at desc, id desc);
create or replace function ai_rcpt_control_events_append_only() returns trigger language plpgsql as $$
begin raise exception 'ai_receptionist_control_events is append-only'; end $$;
drop trigger if exists trg_ai_rcpt_control_events_append_only on ai_receptionist_control_events;
create trigger trg_ai_rcpt_control_events_append_only before update or delete on ai_receptionist_control_events
  for each row execute function ai_rcpt_control_events_append_only();

-- one row per "Check AI Receptionist System" press (read-only check; the run itself is the evidence trail)
create table if not exists ai_receptionist_health_runs (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id),
  branch_id      uuid,
  overall        text not null,
  checks         jsonb not null default '[]'::jsonb,
  checked_by     uuid,
  created_at     timestamptz not null default clock_timestamp()
);
create index if not exists idx_ai_rcpt_health_runs on ai_receptionist_health_runs (tenant_id, created_at desc, id desc);

-- priority worklist actions: Recommended → Prepared → Awaiting confirmation → Executing → Confirmed | Failed | Cancelled | Expired
create table if not exists ai_receptionist_actions (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id),
  branch_id        uuid,
  kind             text not null check (kind in ('create_follow_up')),
  status           text not null default 'awaiting_confirmation'
                     check (status in ('recommended', 'prepared', 'awaiting_confirmation', 'executing', 'confirmed', 'failed', 'cancelled', 'expired')),
  source_type      text not null check (source_type in ('call', 'handoff', 'verification', 'follow_up')),
  source_ref       text not null,
  payload          jsonb not null default '{}'::jsonb,
  prepared_by      uuid,
  prepared_reason  text,
  decided_by       uuid,
  decided_at       timestamptz,
  decision_reason  text,
  result_ref       text,
  failure_reason   text,
  policy_decision  text,
  idempotency_key  text not null,
  version          integer not null default 1,
  created_at       timestamptz not null default clock_timestamp(),
  updated_at       timestamptz not null default now(),
  updated_by       uuid
);
create unique index if not exists uq_ai_rcpt_actions_idem on ai_receptionist_actions (tenant_id, idempotency_key);
-- one open action per worklist item
create unique index if not exists uq_ai_rcpt_actions_open on ai_receptionist_actions (tenant_id, source_type, source_ref, kind)
  where status in ('prepared', 'awaiting_confirmation', 'executing');
create index if not exists idx_ai_rcpt_actions_status on ai_receptionist_actions (tenant_id, status, created_at);

-- call history paging / KPI windows
create index if not exists idx_vco_tenant_started on voice_call_outcomes (tenant_id, (coalesce(started_at, created_at)) desc, id desc);
create index if not exists idx_vco_tenant_created on voice_call_outcomes (tenant_id, created_at desc, id desc);
