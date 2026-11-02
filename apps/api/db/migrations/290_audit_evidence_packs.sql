-- 193_audit_evidence_packs.sql — audit evidence export packets + append-only chain of custody. An evidence packet is a
-- redacted, scoped CSV export with a SHA-256 checksum and an integrity manifest; the packet content is not stored, only
-- its metadata + checksum (so integrity can be re-verified). Every generation / access / download / verification is
-- appended to the chain of custody, which is APPEND-ONLY and never rewritten.
create table if not exists audit_evidence_packs (
  id uuid primary key default gen_random_uuid(),
  pack_ref text not null unique,
  requested_by text,
  requested_by_id uuid,
  scope jsonb not null default '{}'::jsonb,
  format text not null default 'csv',
  event_count int not null default 0,
  checksum text not null,
  manifest jsonb not null default '{}'::jsonb,
  redaction_applied boolean not null default true,
  status text not null default 'ready' check (status in ('ready','expired','revoked')),
  created_at timestamptz not null default now(),
  expires_at timestamptz
);
create index if not exists ix_audit_evidence_packs_status on audit_evidence_packs (status);

create table if not exists audit_evidence_custody (
  id uuid primary key default gen_random_uuid(),
  pack_id uuid not null references audit_evidence_packs(id) on delete cascade,
  entry_type text not null check (entry_type in ('generated','accessed','downloaded','verified','verification_failed')),
  actor text,
  purpose text,
  created_at timestamptz not null default now()
);
create index if not exists ix_audit_evidence_custody_pack on audit_evidence_custody (pack_id, created_at);
