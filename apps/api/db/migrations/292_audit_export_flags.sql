-- 195_audit_export_flags.sql — export-risk flags raised by documented rules against data-export audit events. Each
-- (event_ref, rule_key) is unique (idempotent scan). A reviewer can confirm (reviewed) or dismiss (false positive with
-- reason); review history is preserved on the row. Flagging never alters the underlying audit_events rows.
create table if not exists audit_export_flags (
  id uuid primary key default gen_random_uuid(),
  event_ref text not null,
  tenant_id uuid,
  rule_key text not null,
  rule_version int not null default 1,
  risk text not null check (risk in ('low','medium','high','critical')),
  reason text not null,
  status text not null default 'open' check (status in ('open','reviewed','dismissed')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  unique (event_ref, rule_key)
);
create index if not exists ix_audit_export_flags_status on audit_export_flags (status);
