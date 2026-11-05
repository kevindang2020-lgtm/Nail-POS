-- 356_webauthn_passkeys.sql — passkey (WebAuthn / Face ID / Touch ID) credential + challenge storage.
-- Additive and inert until the feature is configured (rpId + expectedOrigin) and enabled. Does NOT alter the
-- existing password-login path. Credentials are stored per user (and tenant, for tenant-scoped login surfaces);
-- sign_count is monotonic replay protection. Challenges are short-lived (5 min) and single-use (consumed on finish).

CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  credential_id  TEXT NOT NULL UNIQUE,            -- base64url authenticator credential id
  user_id        UUID NOT NULL,
  tenant_id      UUID,                            -- null for super-admin / non-tenant users
  public_key     TEXT NOT NULL,                   -- base64url COSE public key
  sign_count     BIGINT NOT NULL DEFAULT 0,       -- monotonic; incoming <= stored is rejected (cloned authenticator)
  transports     TEXT,                            -- comma-separated hints (usb,nfc,ble,internal)
  device_label   TEXT,                            -- user-facing label ("iPhone 15", "YubiKey")
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ix_webauthn_credentials_user ON webauthn_credentials (user_id);
CREATE INDEX IF NOT EXISTS ix_webauthn_credentials_tenant ON webauthn_credentials (tenant_id);

CREATE TABLE IF NOT EXISTS webauthn_challenges (
  handle       TEXT PRIMARY KEY,                  -- opaque handle returned to the client on begin*
  challenge    TEXT NOT NULL,                     -- base64url random challenge
  user_id      UUID,                              -- null during authentication when the user is not yet resolved
  tenant_id    UUID,
  purpose      TEXT NOT NULL,                     -- 'register' | 'authenticate'
  expires_at   TIMESTAMPTZ NOT NULL,              -- 5 minutes from issue
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_webauthn_challenges_expires ON webauthn_challenges (expires_at);
