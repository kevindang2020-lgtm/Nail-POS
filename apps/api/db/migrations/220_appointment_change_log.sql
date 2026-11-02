-- 175_appointment_change_log.sql
-- Append-only, immutable field-level history of appointment lifecycle changes, consumed by
-- Super Admin → Appointment Oversight → Change History. Rows are written best-effort from the
-- appointment mutation paths (status changes, reschedules, …) and must never be modified or deleted:
-- UPDATE/DELETE are rejected by rules so the log is tamper-evident. tenant_id is always recorded so
-- the Super Admin read path stays scope-enforced.

create table if not exists appointment_change_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid,
  appointment_id uuid not null,
  change_type text not null check (change_type in ('created', 'updated', 'status_changed', 'rescheduled', 'cancelled', 'assigned')),
  field text,
  old_value text,
  new_value text,
  actor_type text,
  actor_id uuid,
  source text,
  created_at timestamptz not null default now()
);

create index if not exists idx_appt_change_log_tenant on appointment_change_log (tenant_id, created_at desc);
create index if not exists idx_appt_change_log_appt on appointment_change_log (appointment_id, created_at desc);

-- Immutability: silently reject any attempt to UPDATE or DELETE recorded history.
create or replace rule appt_change_log_no_update as on update to appointment_change_log do instead nothing;
create or replace rule appt_change_log_no_delete as on delete to appointment_change_log do instead nothing;
