-- 176_booking_checkin_retry_attempts.sql
-- Append-only log of Super Admin controlled retry requests against recorded failed booking/check-in events.
-- This is the *only* write path the Booking & Check-In Monitor exposes, and it is a technical reprocessing
-- action — never a receptionist booking/check-in. Idempotency is enforced at the DB level via a unique
-- (failed_event_id, idempotency_key) constraint so a replayed request can never double-enqueue or
-- double-increment. The original failure record is preserved; this table holds the attempt history.

create table if not exists booking_checkin_retry_attempts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid,
  failed_event_id uuid not null references booking_checkin_failed_events(id) on delete cascade,
  idempotency_key text not null,
  attempt_number int not null,
  status text not null default 'requested'
    check (status in ('requested','in_progress','succeeded','failed','escalated','not_eligible')),
  backoff_seconds int not null default 0,
  next_retry_at timestamptz,
  requested_by_user_id uuid,
  requested_by_email text,
  reason text,
  safe_error text,
  created_at timestamptz not null default now(),
  unique (failed_event_id, idempotency_key)
);

create index if not exists idx_bc_retry_attempts_event on booking_checkin_retry_attempts (failed_event_id, created_at desc);
create index if not exists idx_bc_retry_attempts_tenant on booking_checkin_retry_attempts (tenant_id, branch_id, created_at desc);
create index if not exists idx_bc_retry_attempts_next on booking_checkin_retry_attempts (next_retry_at) where status in ('requested','in_progress');
