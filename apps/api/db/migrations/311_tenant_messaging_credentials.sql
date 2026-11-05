-- 311_tenant_messaging_credentials.sql — per-tenant messaging provider credentials, managed from Super Admin. Lets each
-- salon run on its OWN Twilio account (Account SID + Auth Token + From number) instead of a single shared env var,
-- which is what multi-tenant A2P 10DLC requires. The auth token is stored AES-256-GCM-encrypted (provider-crypto /
-- PROVIDER_VAULT_KEK) and is NEVER returned by any read path — reads expose only the last 4 as a masked hint.
CREATE TABLE IF NOT EXISTS tenant_messaging_credentials (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL,
  provider           TEXT NOT NULL DEFAULT 'twilio',
  account_sid        TEXT,
  auth_token_enc     TEXT,                       -- AES-256-GCM ciphertext; never returned in reads
  auth_token_last4   TEXT,                       -- masked hint only
  from_number        TEXT,                       -- E.164, this tenant's sending number
  status             TEXT NOT NULL DEFAULT 'not_configured',  -- not_configured | configured
  updated_by_user_id UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_messaging_credentials ON tenant_messaging_credentials (tenant_id, provider);
