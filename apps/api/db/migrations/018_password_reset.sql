-- 018_password_reset.sql — EXTENDS existing auth (001). No table is recreated.
-- password_reset_tokens already exists (001); add the temp-code/tenant/rate columns.
ALTER TABLE password_reset_tokens ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE password_reset_tokens ADD COLUMN IF NOT EXISTS phone_normalized TEXT;
ALTER TABLE password_reset_tokens ADD COLUMN IF NOT EXISTS token_type TEXT NOT NULL DEFAULT 'temporary_password';
ALTER TABLE password_reset_tokens ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE password_reset_tokens ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 5;
ALTER TABLE password_reset_tokens ADD COLUMN IF NOT EXISTS requested_ip TEXT;
ALTER TABLE password_reset_tokens ADD COLUMN IF NOT EXISTS requested_user_agent TEXT;

-- new table: SMS delivery audit (not present in 001).
CREATE TABLE IF NOT EXISTS sms_delivery_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID,
  user_id         UUID,
  phone_masked    TEXT NOT NULL,
  template        TEXT NOT NULL,
  provider_sid    TEXT,
  status          TEXT NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued','sent','delivered','failed')),
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- indexes (§10).
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_expires ON password_reset_tokens (tenant_id, user_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_type ON password_reset_tokens (token_type, expires_at);
CREATE INDEX IF NOT EXISTS idx_users_tenant_phone ON users (tenant_id, normalized_phone);
CREATE INDEX IF NOT EXISTS idx_tenants_code ON tenants (tenant_code);
CREATE INDEX IF NOT EXISTS idx_sms_delivery_logs_tenant ON sms_delivery_logs (tenant_id, created_at);
