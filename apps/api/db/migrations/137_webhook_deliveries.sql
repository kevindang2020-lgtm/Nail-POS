-- 137_webhook_deliveries.sql — durable delivery ledger for the webhook event dispatcher (spec §53). Each row is one
-- event→webhook delivery, retried with exponential backoff until delivered, non-retryably failed, or dead (attempts
-- exhausted). A worker/cron calls processDue() to pick up pending rows whose next_attempt_at has passed. payload holds
-- the signed envelope body; it must NOT contain secrets (the signature lives only in the request header at send time).
CREATE TABLE IF NOT EXISTS tenant_webhook_deliveries (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  webhook_id        UUID NOT NULL,
  event_type        TEXT NOT NULL,
  payload           JSONB,
  status            TEXT NOT NULL DEFAULT 'pending',   -- pending | delivered | failed | dead
  attempt_count     INT  NOT NULL DEFAULT 0,
  max_attempts      INT  NOT NULL DEFAULT 5,
  next_attempt_at   TIMESTAMPTZ,
  last_status_code  INT,
  last_error        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_due ON tenant_webhook_deliveries (tenant_id, status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook ON tenant_webhook_deliveries (tenant_id, webhook_id, created_at DESC);
