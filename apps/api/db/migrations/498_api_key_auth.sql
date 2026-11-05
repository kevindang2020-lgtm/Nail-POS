-- 498_api_key_auth.sql — Constitution 3 §76–78 (Step 7, Oct 3 2026): tenant API keys (tenant_api_keys, migration 134)
-- could be issued, rotated and revoked, but NO request was ever authenticated with one. Now they are; rotation keeps the
-- previous secret valid for an overlap window so a live integration can switch without an outage; every use is logged.
ALTER TABLE tenant_api_keys ADD COLUMN IF NOT EXISTS previous_secret_hash TEXT;
ALTER TABLE tenant_api_keys ADD COLUMN IF NOT EXISTS previous_valid_until TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS ux_tenant_api_keys_secret ON tenant_api_keys (secret_hash);
CREATE INDEX IF NOT EXISTS ix_tenant_api_keys_previous ON tenant_api_keys (previous_secret_hash) WHERE previous_secret_hash IS NOT NULL;
CREATE TABLE IF NOT EXISTS tenant_api_key_uses (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key_id     UUID NOT NULL REFERENCES tenant_api_keys (id) ON DELETE CASCADE,
  tenant_id  UUID NOT NULL,
  used_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  method     TEXT NOT NULL,
  route      TEXT NOT NULL,
  ip         TEXT,
  via_previous_secret BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS ix_tenant_api_key_uses_key ON tenant_api_key_uses (key_id, used_at DESC);
