-- 500_security_not_me_tokens.sql — Constitution 3 §89–90 (Step 10a, Oct 3 2026): the "new device signed in to your account"
-- alert carries a one-time "This wasn't me" link. Only the hash of its token is stored; it works once, for 7 days.
CREATE TABLE IF NOT EXISTS security_not_me_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  device_id   UUID REFERENCES auth_devices (id) ON DELETE SET NULL,
  token_hash  TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ix_security_not_me_user ON security_not_me_tokens (user_id);
