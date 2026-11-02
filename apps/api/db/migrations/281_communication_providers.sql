-- 184_communication_providers.sql — communication provider connections (§27). The provider SECRET lives ONLY in the
-- AES-256-GCM vault column (credential_enc) and is NEVER selected into an API response, export, or log; a safe masked
-- hint (credential_last4) is kept for display. Health is derived from real delivery signals, not from "credentials are
-- configured". A freshly added provider starts in 'test' (unverified) until validated.
create table if not exists communication_providers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  channel text not null check (channel in ('sms','email','push','multi')),
  region text,
  account_reference text,                          -- safe reference (e.g. masked account id) — not a secret
  api_endpoint text,
  webhook_endpoint text,
  webhook_signing_status text not null default 'unconfigured' check (webhook_signing_status in ('unconfigured','configured','verified')),
  priority int not null default 100,
  failover_priority int,
  rate_limit int,
  monthly_limit int,
  status text not null default 'test' check (status in ('active','inactive','test','degraded','down','suspended','misconfigured')),
  credential_enc text,                             -- AES-256-GCM vault — NEVER returned by any read path
  credential_last4 text,                           -- safe display hint only
  last_successful_at timestamptz,
  last_health_check_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ix_communication_providers_channel on communication_providers (channel, status);
