-- 075_device_push_tokens.sql
-- Push-notification delivery: a per-user device token registry (FCM/APNs/web push) plus extending the existing
-- notification_delivery_logs channel set to include 'push' so push attempts are logged alongside sms/email.
-- The actual send goes through a pluggable provider (mock by default; FCM adapter when credentials are configured).

CREATE TABLE IF NOT EXISTS device_push_tokens (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID,                                   -- null for platform/super-admin users
  user_id      UUID NOT NULL,
  platform     TEXT NOT NULL CHECK (platform IN ('ios','android','web')),
  token        TEXT NOT NULL,
  app          TEXT,                                   -- which app registered it (customer/tech/owner/pos), informational
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- one row per physical device token; re-registering the same token updates it rather than duplicating.
CREATE UNIQUE INDEX IF NOT EXISTS uq_device_push_tokens_token ON device_push_tokens (token);
CREATE INDEX IF NOT EXISTS idx_device_push_tokens_user ON device_push_tokens (user_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_device_push_tokens_tenant ON device_push_tokens (tenant_id) WHERE revoked_at IS NULL;

-- Allow 'push' in notification_delivery_logs.channel (was: sms,email). Constraint name is auto-generated, so look it up.
DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c FROM pg_constraint
    WHERE conrelid = 'notification_delivery_logs'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%channel%';
  IF c IS NOT NULL THEN EXECUTE 'ALTER TABLE notification_delivery_logs DROP CONSTRAINT ' || quote_ident(c); END IF;
END $$;
ALTER TABLE notification_delivery_logs
  ADD CONSTRAINT notification_delivery_logs_channel_check CHECK (channel IN ('sms','email','push'));
