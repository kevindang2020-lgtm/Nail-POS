-- 495_mfa_recovery_codes.sql — Constitution 3 §66–67 (Step 3, Oct 3 2026): self-service MFA recovery codes. A lost
-- authenticator used to mean an admin reset (the mfa_recovery_tokens workflow, migration 469 — unchanged). Each code is
-- stored only as a hash, works ONCE, and generating a new set retires every code of the old one.
CREATE TABLE IF NOT EXISTS mfa_recovery_codes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  code_hash   TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  used_at     TIMESTAMPTZ,
  retired_at  TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_mfa_recovery_codes_hash ON mfa_recovery_codes (code_hash);
CREATE INDEX IF NOT EXISTS ix_mfa_recovery_codes_live ON mfa_recovery_codes (user_id) WHERE used_at IS NULL AND retired_at IS NULL;
