-- 133_user_login_alert_prefs.sql — per-user login-alert preferences (Account → Security, §19).
-- Tenant-scoped per (tenant_id, user_id), exactly like user_avatars: a user can only read/write
-- their OWN prefs (enforced by the session userId in profile.service, never the client). Defaults are
-- security-forward (every alert on); the master `enabled` gates the lot for the Account summary row.
CREATE TABLE IF NOT EXISTS user_login_alert_prefs (
  tenant_id               TEXT NOT NULL,
  user_id                 TEXT NOT NULL,
  enabled                 BOOLEAN NOT NULL DEFAULT true,
  new_device              BOOLEAN NOT NULL DEFAULT true,
  new_location            BOOLEAN NOT NULL DEFAULT true,
  password_changed        BOOLEAN NOT NULL DEFAULT true,
  email_changed           BOOLEAN NOT NULL DEFAULT true,
  phone_changed           BOOLEAN NOT NULL DEFAULT true,
  twofa_changed           BOOLEAN NOT NULL DEFAULT true,
  recovery_codes_changed  BOOLEAN NOT NULL DEFAULT true,
  session_revoked         BOOLEAN NOT NULL DEFAULT true,
  suspicious_blocked      BOOLEAN NOT NULL DEFAULT true,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);
