-- 192_audit_investigations.sql — audit investigation case management. A case links flagged audit events and records an
-- APPEND-ONLY, immutable timeline (created / event_linked / note / status_change). Linking an event or adding a note
-- never rewrites prior entries or the audit_events rows themselves — the log stays tamper-resistant. Only the case's
-- own status field is mutable; every transition is also recorded as a timeline entry.
create table if not exists audit_investigations (
  id uuid primary key default gen_random_uuid(),
  case_ref text not null unique,
  title text not null,
  tenant_id uuid,
  severity text not null default 'medium' check (severity in ('low','medium','high','critical')),
  assignee text,
  status text not null default 'open' check (status in ('open','in_progress','waiting','escalated','resolved','closed','reopened')),
  description text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ix_audit_investigations_status on audit_investigations (status);

-- Immutable, append-only timeline. Rows are inserted, never updated or deleted.
create table if not exists audit_investigation_timeline (
  id uuid primary key default gen_random_uuid(),
  investigation_id uuid not null references audit_investigations(id) on delete cascade,
  entry_type text not null check (entry_type in ('created','event_linked','note','status_change')),
  payload jsonb not null default '{}'::jsonb,
  author text,
  created_at timestamptz not null default now()
);
create index if not exists ix_audit_investigation_timeline_case on audit_investigation_timeline (investigation_id, created_at);
