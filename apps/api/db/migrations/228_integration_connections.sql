-- 184_integration_connections.sql — generic third-party integration connection lifecycle.
-- The audit found NO generic connector/OAuth-app model (only payment configs + webhooks + api keys), so this adds
-- the substrate the Add-Integration / Configure-Credentials / OAuth / Refresh workflows sit on. Connection,
-- authentication, sync, and webhook are SEPARATE controlled status columns (never one overloaded field). Secrets are
-- NEVER stored in plaintext: credential rows keep an envelope-encrypted value (AES-256-GCM via webhook-crypto) plus a
-- masked display value; the full secret is never selected back to any caller. OAuth state rows are single-use to
-- block state/code replay; the PKCE verifier is stored encrypted.

CREATE TABLE IF NOT EXISTS integration_connections (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID,                                   -- NULL = platform-managed shared connection
  branch_id              UUID,                                   -- NULL = all authorized branches for the tenant
  provider_key           TEXT NOT NULL,                          -- from the approved provider registry
  category               TEXT NOT NULL,
  ownership_type         TEXT NOT NULL DEFAULT 'platform_tenant',-- platform_shared|platform_tenant|tenant_owned|branch|enterprise
  connection_status      TEXT NOT NULL DEFAULT 'draft',          -- draft|pending_setup|active|warning|degraded|failed|disabled|compromised|retired
  authentication_status  TEXT NOT NULL DEFAULT 'not_configured', -- not_configured|valid|expiring_soon|expired|invalid|revoked|reauthorization_required|scope_missing
  sync_status            TEXT NOT NULL DEFAULT 'never_synced',   -- never_synced|scheduled|running|successful|partial|delayed|failed|paused|disabled
  webhook_status         TEXT NOT NULL DEFAULT 'not_configured', -- not_supported|not_configured|healthy|warning|failed|disabled|signature_error|replay_blocked
  auth_method            TEXT,                                   -- oauth2|api_key|none
  credential_reference_id UUID,                                  -- current active credential ref (FK-ish, soft)
  configuration_version  INT NOT NULL DEFAULT 1,
  granted_scopes         TEXT[] NOT NULL DEFAULT '{}',
  provider_account       TEXT,                                   -- provider-returned account identifier (non-secret)
  token_expires_at       TIMESTAMPTZ,
  last_successful_sync_at TIMESTAMPTZ,
  last_failed_sync_at    TIMESTAMPTZ,
  next_sync_at           TIMESTAMPTZ,
  disabled_reason        TEXT,
  created_by_user_id     UUID,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- one live connection per (provider, tenant-scope, branch-scope); NULLs normalized so platform-shared dupes are caught
CREATE UNIQUE INDEX IF NOT EXISTS uq_integration_conn_scope ON integration_connections
  (provider_key, COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE connection_status <> 'retired';
CREATE INDEX IF NOT EXISTS ix_integration_conn_tenant ON integration_connections (tenant_id);
CREATE INDEX IF NOT EXISTS ix_integration_conn_provider ON integration_connections (provider_key);
CREATE INDEX IF NOT EXISTS ix_integration_conn_status ON integration_connections (connection_status);
CREATE INDEX IF NOT EXISTS ix_integration_conn_auth ON integration_connections (authentication_status);
CREATE INDEX IF NOT EXISTS ix_integration_conn_next_sync ON integration_connections (next_sync_at);

CREATE TABLE IF NOT EXISTS integration_credential_references (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id      UUID NOT NULL,
  tenant_id          UUID,
  kind               TEXT NOT NULL,                              -- oauth_access|oauth_refresh|api_key|client_secret|webhook_secret|signing_key
  secret_enc         TEXT NOT NULL,                              -- AES-256-GCM envelope-encrypted; NEVER returned
  masked_value       TEXT,                                       -- e.g. '••••••••9XAK' — safe to display
  version            INT NOT NULL DEFAULT 1,
  status             TEXT NOT NULL DEFAULT 'active',             -- active|rotated|revoked
  expires_at         TIMESTAMPTZ,
  created_by_user_id UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  rotated_at         TIMESTAMPTZ,
  revoked_at         TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ix_integration_cred_conn ON integration_credential_references (connection_id, kind, status);

CREATE TABLE IF NOT EXISTS integration_oauth_states (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id      UUID,
  provider_key       TEXT NOT NULL,
  state              TEXT NOT NULL UNIQUE,                       -- single-use; consumed on completion (replay → rejected)
  code_verifier_enc  TEXT,                                       -- PKCE verifier, encrypted
  redirect_uri       TEXT NOT NULL,                              -- validated against the provider allowlist at begin-time
  requested_scopes   TEXT[] NOT NULL DEFAULT '{}',
  status             TEXT NOT NULL DEFAULT 'pending',            -- pending|consumed|expired
  created_by_user_id UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at         TIMESTAMPTZ NOT NULL DEFAULT now() + interval '15 minutes',
  consumed_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ix_integration_oauth_state_conn ON integration_oauth_states (connection_id);
