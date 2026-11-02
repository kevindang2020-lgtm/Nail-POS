-- 134_api_keys_webhooks.sql — tenant API keys + outbound webhooks for the Devices & Integrations module
-- (spec §53). SECURITY: API-key secrets are stored as one-way hashes (secret_hash, verified by re-hashing); webhook
-- signing secrets are stored AES-256-GCM-ENCRYPTED (signing_secret_enc) because the server must recover them to sign.
-- only plaintext fragment kept, purely so a key can be identified in lists. Everything is tenant-scoped.

CREATE TABLE IF NOT EXISTS tenant_api_keys (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL,
  name                TEXT NOT NULL,
  prefix              TEXT NOT NULL,                       -- e.g. 'ak_live_Ab12' — shown for identification only
  secret_hash         TEXT NOT NULL,                       -- sha-256 of the full secret; raw secret is never stored
  environment         TEXT NOT NULL DEFAULT 'live',        -- 'live' | 'test'
  scopes              TEXT[] NOT NULL DEFAULT '{}',
  created_by_user_id  UUID,
  last_used_at        TIMESTAMPTZ,
  expires_at          TIMESTAMPTZ,
  revoked_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tenant_api_keys_tenant ON tenant_api_keys (tenant_id) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS tenant_webhooks (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL,
  name                 TEXT NOT NULL,
  url                  TEXT NOT NULL,
  events               TEXT[] NOT NULL DEFAULT '{}',
  signing_secret_enc   TEXT NOT NULL,                      -- AES-256-GCM encrypted; server needs it to HMAC-sign deliveries
  status               TEXT NOT NULL DEFAULT 'active',     -- 'active' | 'paused' | 'disabled'
  created_by_user_id   UUID,
  last_delivery_at     TIMESTAMPTZ,
  last_success_at      TIMESTAMPTZ,
  last_failure_at      TIMESTAMPTZ,
  failure_count        INTEGER NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tenant_webhooks_tenant ON tenant_webhooks (tenant_id);
