-- 179_overage_charges.sql — materialized overage charges per tenant × metric × billing period. Computed from real
-- usage vs the effective (soft) limit using integer-cents arithmetic (decimal-safe). One row per (tenant, metric,
-- period); recomputation upserts. Money in BIGINT cents.

CREATE TABLE IF NOT EXISTS overage_charges (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  metric           text NOT NULL,
  billing_period   text NOT NULL,                 -- 'YYYY-MM'
  included_qty     bigint NOT NULL,
  used_qty         bigint NOT NULL,
  overage_qty      bigint NOT NULL,
  unit_price_cents bigint NOT NULL,
  amount_cents     bigint NOT NULL,
  status           text NOT NULL DEFAULT 'active', -- active|void
  computed_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, metric, billing_period)
);
CREATE INDEX IF NOT EXISTS idx_overage_charges_period ON overage_charges (billing_period, metric);
