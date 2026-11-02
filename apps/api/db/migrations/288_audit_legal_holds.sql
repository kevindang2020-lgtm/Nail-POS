-- 191_audit_legal_holds.sql — legal hold register for Audit Logs. A hold protects a defined SLICE of audit events from
-- retention purges (by tenant / user / action / date range / global). Holds are an OVERLAY: they never modify, delete,
-- or destructively reference audit_events rows — tamper-resistance is preserved. Releasing a hold requires a reason and
-- is recorded here (and audited when tenant-scoped). Placing/releasing does not touch any log row.
create table if not exists audit_legal_holds (
  id uuid primary key default gen_random_uuid(),
  hold_ref text not null unique,
  scope_type text not null check (scope_type in ('global','tenant','user','action','date_range')),
  scope_value text,                                -- tenant_id / user_id / action substring / "startISO|endISO"; null for global
  reason text not null,
  legal_authority text,
  status text not null default 'active' check (status in ('active','released','expired')),
  created_by uuid,
  created_at timestamptz not null default now(),
  review_date date,
  expiration_date date,
  released_by uuid,
  released_at timestamptz,
  release_reason text
);
create index if not exists ix_audit_legal_holds_status on audit_legal_holds (status);
