-- 038_payment_settlements_refunds.sql
-- Tenant-isolated settlement + refund ledgers (Payment Gateway Isolation §7/§16).
--
-- Gateway webhooks report two kinds of money movement that previously had nowhere structured to land: REFUNDS (per
-- payment) and SETTLEMENTS/batches (per merchant). These tables give them a home, scoped to one tenant + branch, so the
-- per-tenant gateway reconciliation read can total them without ever crossing tenants. No raw card data is stored.
-- Idempotency is enforced at the application layer (dedup by processor_refund_id / settlement_id / event_id).

CREATE TABLE IF NOT EXISTS payment_refunds (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL,
  branch_id            UUID,
  payment_id           UUID,                 -- the (tenant-scoped) payment this refund applies to
  payment_gateway_id   UUID,                 -- resolved tenant_payment_config key (= tenant_id here)
  processor_type       TEXT,
  amount_cents         INTEGER NOT NULL DEFAULT 0,
  reason               TEXT,
  status               TEXT NOT NULL DEFAULT 'refunded',
  processor_refund_id  TEXT,
  event_id             TEXT,
  created_by_user_id   UUID,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payment_settlements (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL,
  branch_id            UUID,
  payment_gateway_id   UUID,
  processor_type       TEXT,
  settlement_id        TEXT,                 -- processor batch/settlement id
  gross_cents          INTEGER NOT NULL DEFAULT 0,
  fee_cents            INTEGER NOT NULL DEFAULT 0,
  net_cents            INTEGER NOT NULL DEFAULT 0,
  currency             TEXT NOT NULL DEFAULT 'USD',
  status               TEXT NOT NULL DEFAULT 'settled',
  event_id             TEXT,
  payload_json_safe    JSONB,
  settled_at           TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prefunds_tenant_created ON payment_refunds (tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_prefunds_proc_id ON payment_refunds (processor_refund_id);
CREATE INDEX IF NOT EXISTS idx_psettle_tenant_created ON payment_settlements (tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_psettle_settlement_id ON payment_settlements (settlement_id);
