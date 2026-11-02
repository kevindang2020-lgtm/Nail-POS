-- 698_platform_device_approval.sql — Security Deep Scan §29 / §136 (S-A13, Oct 27 2026): a trusted-device requirement for
-- platform (Super Admin) sign-in. A platform account signs in only from a device approved for platform use
-- (modules/identity/src/auth/platform-device-trust.ts). A device is approved by: the account's first device (bootstrap),
-- a one-time emailed link to the account holder, an already-approved device of the same account, or this migration's
-- backfill of the devices platform accounts already use. Revoking / blocking a device clears its approval.
ALTER TABLE auth_devices ADD COLUMN IF NOT EXISTS platform_approved_at  TIMESTAMPTZ;
ALTER TABLE auth_devices ADD COLUMN IF NOT EXISTS platform_approved_via TEXT;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auth_devices_platform_via_check') THEN
    ALTER TABLE auth_devices ADD CONSTRAINT auth_devices_platform_via_check
      CHECK (platform_approved_via IS NULL OR platform_approved_via IN ('first_device', 'email', 'device', 'migration'));
  END IF;
END $$;

-- The one-time approval links (only the sha256 of the token is stored; 30-minute life; single use).
CREATE TABLE IF NOT EXISTS platform_device_approvals (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  device_id   UUID NOT NULL REFERENCES auth_devices (id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  ip          TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ix_platform_device_approvals_user ON platform_device_approvals (user_id, created_at DESC);

-- Backfill: the devices Super Admin accounts already sign in from stay usable (no lockout on deploy).
UPDATE auth_devices d SET platform_approved_at = now(), platform_approved_via = 'migration'
 WHERE d.platform_approved_at IS NULL AND d.trust_state NOT IN ('blocked', 'revoked')
   AND EXISTS (SELECT 1 FROM users u WHERE u.id = d.user_id AND u.role = 'SUPER_ADMIN');
