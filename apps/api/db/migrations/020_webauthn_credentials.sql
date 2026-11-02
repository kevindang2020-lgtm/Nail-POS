-- 020_webauthn_credentials.sql — Face ID / Touch ID (WebAuthn platform passkeys). Extends auth; no recreates.
CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID,                       -- null for SUPER_ADMIN
  user_id         UUID NOT NULL,
  credential_id   TEXT NOT NULL UNIQUE,       -- base64url
  public_key      TEXT NOT NULL,              -- base64url COSE key
  sign_count      BIGINT NOT NULL DEFAULT 0,
  transports      TEXT,                       -- e.g. "internal"
  device_label    TEXT,                       -- "iPhone · Face ID"
  aaguid          TEXT,
  backed_up       BOOLEAN NOT NULL DEFAULT false,
  last_used_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_webauthn_credentials_user ON webauthn_credentials (tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_webauthn_credentials_credid ON webauthn_credentials (credential_id);

-- short-lived registration/authentication challenges
CREATE TABLE IF NOT EXISTS webauthn_challenges (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  handle       TEXT NOT NULL UNIQUE,          -- opaque id returned to the client
  user_id      UUID,
  tenant_id    UUID,
  challenge    TEXT NOT NULL,
  purpose      TEXT NOT NULL CHECK (purpose IN ('register','authenticate')),
  expires_at   TIMESTAMPTZ NOT NULL,
  consumed_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_handle ON webauthn_challenges (handle, expires_at);

-- enable the existing settings flag now that it's real
-- (settings.security.passkeyEnabled — toggled per tenant in Settings Center)
