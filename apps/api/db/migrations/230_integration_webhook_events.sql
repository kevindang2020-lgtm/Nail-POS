-- 186_integration_webhook_events.sql — INBOUND webhook events received FROM providers, bound to an
-- integration_connection. Distinct from tenant_webhooks/tenant_webhook_deliveries (OUTBOUND, we sign & deliver) and
-- payment_gateway_events (payment processors). Each row is one inbound event; UNIQUE (connection_id,
-- provider_event_id) is the dedup ledger so the same signed event is never processed twice. Signature and replay are
-- verified BEFORE acceptance; the raw payload is never stored (only a redacted, safe summary). Business processing is
-- handed off asynchronously (status queued→processing→processed|failed|dead), so the endpoint responds within the
-- provider timeout.

CREATE TABLE IF NOT EXISTS integration_webhook_events (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id      UUID NOT NULL,
  tenant_id          UUID,                                  -- resolved from the connection (never trusted from payload)
  provider_event_id  TEXT NOT NULL,                         -- provider's unique event id; dedup key
  event_type         TEXT,
  signature_result   TEXT NOT NULL DEFAULT 'valid',         -- valid|invalid|missing
  replay_result      TEXT NOT NULL DEFAULT 'ok',            -- ok|blocked
  status             TEXT NOT NULL DEFAULT 'queued',        -- queued|processing|processed|failed|dead|rejected|duplicate
  attempt_count      INT NOT NULL DEFAULT 0,
  max_attempts       INT NOT NULL DEFAULT 5,
  redacted_summary   JSONB,                                 -- safe, non-secret subset only
  correlation_id     UUID,
  error_category     TEXT,
  error_message      TEXT,
  next_attempt_at    TIMESTAMPTZ,
  received_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at       TIMESTAMPTZ,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_int_webhook_event ON integration_webhook_events (connection_id, provider_event_id);
CREATE INDEX IF NOT EXISTS ix_int_webhook_event_conn ON integration_webhook_events (connection_id, status);
CREATE INDEX IF NOT EXISTS ix_int_webhook_event_status ON integration_webhook_events (status, next_attempt_at);
CREATE INDEX IF NOT EXISTS ix_int_webhook_event_tenant ON integration_webhook_events (tenant_id);
