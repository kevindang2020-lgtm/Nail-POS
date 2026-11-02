-- 037_payment_gateway_events.sql
-- Inbound payment-gateway webhook events (Payment Gateway Isolation §14).
--
-- Every webhook the platform receives is recorded here BEFORE/while it is processed: the resolved tenant (NULL until a
-- merchant id is matched), whether the signature verified, the (tenant-scoped) payment it applied to, and when it was
-- processed. This table is both the idempotency ledger (dedup by event_id) and the webhook audit trail
-- (payment_webhook_received / payment_webhook_signature_failed / unknown-merchant rejections are all rows here).
-- No secrets are stored — only a masked merchant id and a safe JSON payload.

CREATE TABLE IF NOT EXISTS payment_gateway_events (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 UUID,                 -- NULL until resolved by merchant id
  branch_id                 UUID,                 -- copied from the matched payment, if any
  payment_gateway_id        UUID,                 -- the tenant_payment_config the merchant resolved to (= tenant_id here)
  processor_type            TEXT NOT NULL,
  event_type                TEXT,
  event_id                  TEXT,                 -- processor's unique event id; used for idempotency
  processor_transaction_id  TEXT,
  merchant_id_masked        TEXT,
  payload_json_safe         JSONB,
  signature_valid           BOOLEAN NOT NULL DEFAULT FALSE,
  matched_payment_id        UUID,                 -- the payment this event updated (tenant-scoped), if any
  processed_at              TIMESTAMPTZ,          -- NULL = recorded but not processed (rejected / bad signature)
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pge_event_id ON payment_gateway_events (event_id);
CREATE INDEX IF NOT EXISTS idx_pge_tenant_created ON payment_gateway_events (tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_pge_txn ON payment_gateway_events (processor_transaction_id);
