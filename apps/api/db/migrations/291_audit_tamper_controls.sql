-- 194_audit_tamper_controls.sql — recorded configuration + verification status for the Tamper-Resistance & Retention
-- Status panel. Each control's value and status are set by an authorized admin and stamped with a last-verified time;
-- the panel reflects THESE recorded values (not a hardcoded "Compliant"). An unset control reads 'not_configured'.
create table if not exists audit_tamper_controls (
  id uuid primary key default gen_random_uuid(),
  control_key text not null unique check (control_key in ('worm_storage','retention_policy','digital_signature','backup_replication','encryption')),
  value text not null,
  status text not null default 'not_configured' check (status in ('compliant','active','enabled','degraded','failed','not_configured')),
  detail text,
  last_verified_at timestamptz,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
