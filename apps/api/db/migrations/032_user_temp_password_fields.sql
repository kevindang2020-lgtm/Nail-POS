-- 032_user_temp_password_fields.sql — temporary-password + must-change fields on users, for the admin/super-admin
-- initiated reset flow (SystemPasswordResetService). Additive + idempotent.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS temp_password_hash       TEXT,
  ADD COLUMN IF NOT EXISTS temp_password_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS temp_password_delivery   TEXT,
  ADD COLUMN IF NOT EXISTS must_change_password     BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS password_changed_at      TIMESTAMPTZ;
