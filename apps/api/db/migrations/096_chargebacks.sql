-- 096_chargebacks.sql — Payment chargebacks / disputes for the Super Admin → Payment Gateways command center.
-- Integer cents; tenant-scoped. Recorded by the inbound payment-gateway webhook (payment-webhook.service) the SAME way
-- refunds/settlements are: the tenant is resolved ONLY by merchant id, the signature is verified against that tenant's
-- own secret, and writes are idempotent on the processor's chargeback/case id (unique per tenant). Raw card data is never
-- stored — payload_json_safe is the scrubbed payload. The "Chargeback Alerts" KPI counts the OPEN/unresolved rows.
CREATE TABLE IF NOT EXISTS chargebacks (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  branch_id                UUID,
  payment_gateway_id       UUID,                 -- the tenant_payment_config the merchant resolved to (= tenant_id here)
  payment_id               UUID,                 -- the matched tenant-scoped payment, if any
  processor_type           TEXT,
  chargeback_id            TEXT,                 -- processor's case / dispute id (idempotency key within a tenant)
  processor_transaction_id TEXT,
  reason_code              TEXT,
  reason                   TEXT,
  amount_cents             INTEGER NOT NULL DEFAULT 0,
  currency                 TEXT NOT NULL DEFAULT 'USD',
  status                   TEXT NOT NULL DEFAULT 'open'
                             CHECK (status IN ('open','needs_response','under_review','won','lost','refunded','expired')),
  event_id                 TEXT,                 -- the payment_gateway_events.event_id that created/updated this row
  payload_json_safe        JSONB,
  opened_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  due_by                   TIMESTAMPTZ,
  resolved_at              TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- One row per processor case per tenant (idempotent upsert target).
CREATE UNIQUE INDEX IF NOT EXISTS uq_chargebacks_tenant_case ON chargebacks (tenant_id, chargeback_id) WHERE chargeback_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chargebacks_tenant ON chargebacks (tenant_id);
CREATE INDEX IF NOT EXISTS idx_chargebacks_tenant_status ON chargebacks (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_chargebacks_opened ON chargebacks (opened_at DESC);
