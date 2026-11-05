-- 559_device_biometric_credentials.sql — BUILD_PLAN Phase 13 D (Constitution 6 §37–39, audit bug 2): the biometric
-- DEVICE CREDENTIAL behind Face ID / Touch ID in the four mobile apps.
--
-- Face ID used to enrol the 15-minute ACCESS token into the Keychain, so it could only "work" while the session was
-- still alive anyway. Now Face ID unlocks a long-lived, single-device, revocable credential: 32 random bytes the app keeps
-- in the biometric-guarded Keychain / Keystore item, stored here only as a SHA-256 hash. Signing in with it mints a FRESH
-- session after re-checking the account, the device and the salon's policy; every use ROTATES the secret, and a spent
-- secret presented again revokes the credential (theft). Revoked on sign-out from that device, a password change
-- (password_changed_at newer than the credential), and a device revoke / block.
--
-- `claims` is the session scope captured at enrolment (role, salon, branch, subscription status — never a token, a
-- password or a permission list; permissions are recomputed at every biometric sign-in exactly as a refresh does).
CREATE TABLE IF NOT EXISTS device_biometric_credentials (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  tenant_id          UUID REFERENCES tenants (id) ON DELETE CASCADE,
  auth_device_id     UUID REFERENCES auth_devices (id) ON DELETE CASCADE,
  device_key_hash    TEXT NOT NULL,
  secret_hash        TEXT NOT NULL,
  previous_secret_hash TEXT,
  platform           TEXT,
  device_name        TEXT,
  claims             JSONB NOT NULL DEFAULT '{}'::jsonb,
  status             TEXT NOT NULL DEFAULT 'active',
  revoked_reason     TEXT,
  use_count          INTEGER NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at       TIMESTAMPTZ,
  expires_at         TIMESTAMPTZ NOT NULL,
  revoked_at         TIMESTAMPTZ,
  CONSTRAINT device_biometric_credentials_status_check CHECK (status IN ('active', 'revoked')),
  CONSTRAINT device_biometric_credentials_revoked_check CHECK (status <> 'revoked' OR revoked_at IS NOT NULL),
  CONSTRAINT device_biometric_credentials_platform_check CHECK (platform IS NULL OR platform IN ('ios', 'android'))
);
-- One active credential per (user, device): enrolling again replaces the old one.
CREATE UNIQUE INDEX IF NOT EXISTS ux_device_biometric_credentials_active ON device_biometric_credentials (user_id, device_key_hash) WHERE status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS ux_device_biometric_credentials_secret ON device_biometric_credentials (secret_hash);
CREATE INDEX IF NOT EXISTS ix_device_biometric_credentials_device ON device_biometric_credentials (auth_device_id) WHERE auth_device_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_device_biometric_credentials_tenant ON device_biometric_credentials (tenant_id) WHERE tenant_id IS NOT NULL;
