-- 456_ephemeral_grants.sql — short-lived, single-use grants that must survive a restart and work across instances.
--
-- Activation tickets (a verified phone → pick a salon, 5 min) and password-reset sessions (temp password accepted →
-- choose a new one, 10 min) lived in ONE process's memory: every deploy dropped in-flight flows, and with a second
-- replica a customer landing on the other instance simply failed. They live here now.
-- token_hash is SHA-256 of the bearer token — the token itself is never stored, so a database read yields no usable
-- grant. The payload holds ids and the verified phone only — never a password (the reset flow's "new password must
-- differ from the temporary one" check now compares against the token row's existing HASH, not a stored plaintext).
CREATE TABLE IF NOT EXISTS ephemeral_grants (
  token_hash  TEXT PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('activation_ticket', 'password_reset_session')),
  payload     JSONB NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_ephemeral_grants_expires ON ephemeral_grants (expires_at);
