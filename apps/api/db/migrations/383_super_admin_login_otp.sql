-- 383_super_admin_login_otp.sql — the backend store for the Super Admin login SMS one-time code.
--
-- Every Super Admin login is MFA-mandatory (ROLE_MFA.SUPER_ADMIN = 'required'). When the SMS OTP port is wired
-- (Twilio configured), the second factor is a backend-generated six-digit code, delivered by SMS to the phone on
-- the Super Admin's own users row, and verified here — never on the client. This table holds ONE live challenge
-- per Super Admin (user_id is the PK, so a fresh issue replaces the previous one):
--
--   • code_hash   — the HASH of the code (same hasher as passwords). The plaintext is sent by SMS and never stored.
--   • expires_at  — short TTL (the service uses 5 minutes). Past this, the code is dead.
--   • attempts    — wrong-code counter; the service locks the challenge after a small number of tries.
--   • consumed_at — single use: set on the first correct verification, after which the code can never be reused.
--
-- No tenant_id: Super Admins are platform-level (users.tenant_id IS NULL), so every row is keyed and scoped by the
-- Super Admin's own user_id — a primary-key lookup of the caller's own challenge, never cross-tenant.
CREATE TABLE IF NOT EXISTS super_admin_login_otp (
  user_id     UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  code_hash   TEXT        NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  attempts    INTEGER     NOT NULL DEFAULT 0,
  consumed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sa_login_otp_expires ON super_admin_login_otp (expires_at);
