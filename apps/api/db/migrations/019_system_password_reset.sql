-- 019_system_password_reset.sql — system-wide reset. Extends users + password_reset_tokens (018). No recreates.
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS temporary_password_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS temporary_password_expires_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_requested_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_password_reset_delivery_method TEXT;

ALTER TABLE password_reset_tokens ADD COLUMN IF NOT EXISTS branch_id UUID;
ALTER TABLE password_reset_tokens ADD COLUMN IF NOT EXISTS code_hash TEXT;
ALTER TABLE password_reset_tokens ADD COLUMN IF NOT EXISTS delivery_method TEXT;
ALTER TABLE password_reset_tokens ADD COLUMN IF NOT EXISTS delivery_target_masked TEXT;
ALTER TABLE password_reset_tokens ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;
ALTER TABLE password_reset_tokens ADD COLUMN IF NOT EXISTS ip_address TEXT;
ALTER TABLE password_reset_tokens ADD COLUMN IF NOT EXISTS user_agent TEXT;

CREATE TABLE IF NOT EXISTS notification_delivery_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID,
  user_id       UUID,
  channel       TEXT NOT NULL CHECK (channel IN ('sms','email')),
  target_masked TEXT NOT NULL,
  template      TEXT NOT NULL,
  provider_id   TEXT,
  status        TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','delivered','failed')),
  error_message TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_active ON password_reset_tokens (user_id, expires_at, used_at, revoked_at);
CREATE INDEX IF NOT EXISTS idx_users_tenant_email ON users (tenant_id, email);
CREATE INDEX IF NOT EXISTS idx_notification_delivery_logs_user ON notification_delivery_logs (user_id, created_at);
