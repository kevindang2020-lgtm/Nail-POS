-- 031_password_reset_token_fields.sql — fields the password-reset flow needs on password_reset_tokens
-- (tenant scoping, token type, and attempt tracking). Additive + idempotent.
ALTER TABLE password_reset_tokens
  ADD COLUMN IF NOT EXISTS tenant_id     UUID,
  ADD COLUMN IF NOT EXISTS token_type    TEXT NOT NULL DEFAULT 'temporary_password',
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_attempts  INTEGER NOT NULL DEFAULT 5;
CREATE INDEX IF NOT EXISTS idx_prt_tenant_user_active
  ON password_reset_tokens (tenant_id, user_id, used_at, expires_at);
