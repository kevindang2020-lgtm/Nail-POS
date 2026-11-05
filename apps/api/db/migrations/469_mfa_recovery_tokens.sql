-- 469_mfa_recovery_tokens.sql — Constitution 7 §24 "Reset MFA Through Secure Workflow".
-- A platform administrator resets a platform user's authenticator (step-up, reason, audited): the old factor is removed,
-- the user's sessions end, and ONE single-use recovery token (stored only as a SHA-256 hash, 24 h) lets the user enrol a
-- new authenticator — and only together with their own password. Five wrong attempts burn the token.
CREATE TABLE IF NOT EXISTS mfa_recovery_tokens (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash       TEXT NOT NULL UNIQUE,
  created_by       UUID NULL,
  reason           TEXT NOT NULL,
  expires_at       TIMESTAMPTZ NOT NULL,
  started_at       TIMESTAMPTZ NULL,
  used_at          TIMESTAMPTZ NULL,
  failed_attempts  INT NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mfa_recovery_tokens_user ON mfa_recovery_tokens (user_id, created_at DESC);
