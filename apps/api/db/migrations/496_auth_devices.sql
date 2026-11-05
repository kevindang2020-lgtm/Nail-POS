-- 496_auth_devices.sql — Constitution 3 §21–24 (Step 4, Oct 3 2026): the devices a user signs in from, with a trust state.
-- (device_sessions, migration 001, is the salon's POS-terminal registry — unrelated.) A device is identified by the id
-- the native app mints per install, or on the web by an `aps_device` httpOnly cookie; the key is stored only as a hash
-- (on the web it is a bearer of "this browser", so it is treated like a secret).
CREATE TABLE IF NOT EXISTS auth_devices (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  device_key_hash  TEXT NOT NULL,
  name             TEXT,
  platform         TEXT,
  trust_state      TEXT NOT NULL DEFAULT 'new',
  trusted_until    TIMESTAMPTZ,
  first_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_ip          TEXT,
  sign_in_count    INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT auth_devices_state_check CHECK (trust_state IN ('new', 'recognized', 'trusted', 'suspicious', 'blocked', 'revoked')),
  -- TRUSTED always lapses: "trusted forever" is not a state this table can hold.
  CONSTRAINT auth_devices_trusted_until_check CHECK (trust_state <> 'trusted' OR trusted_until IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_auth_devices_user_key ON auth_devices (user_id, device_key_hash);
-- The session knows its device (revoking a device ends its sessions) and when it last proved a second factor.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS auth_device_id UUID REFERENCES auth_devices (id) ON DELETE SET NULL;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_mfa_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS ix_sessions_auth_device ON sessions (auth_device_id) WHERE auth_device_id IS NOT NULL;
