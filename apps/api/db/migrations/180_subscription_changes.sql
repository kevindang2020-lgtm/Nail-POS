-- 180_subscription_changes.sql — anchor tenant subscriptions to the catalog (plan_code + locked price + billing
-- period) so upgrades/downgrades can be prorated, and record every change in an auditable ledger. Money in BIGINT cents.

ALTER TABLE tenant_subscriptions ADD COLUMN IF NOT EXISTS plan_code            text;
ALTER TABLE tenant_subscriptions ADD COLUMN IF NOT EXISTS current_period_start timestamptz;
ALTER TABLE tenant_subscriptions ADD COLUMN IF NOT EXISTS monthly_price_cents  bigint;
ALTER TABLE tenant_subscriptions ADD COLUMN IF NOT EXISTS billing_interval     text NOT NULL DEFAULT 'monthly';

CREATE TABLE IF NOT EXISTS subscription_changes (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  from_plan_code         text,
  to_plan_code           text NOT NULL,
  change_type            text NOT NULL,                 -- initial|upgrade|downgrade|crossgrade
  strategy               text NOT NULL DEFAULT 'immediate', -- immediate|end_of_cycle
  status                 text NOT NULL DEFAULT 'applied',   -- applied|scheduled
  effective_at           timestamptz NOT NULL DEFAULT now(),
  proration_credit_cents bigint NOT NULL DEFAULT 0,
  proration_charge_cents bigint NOT NULL DEFAULT 0,
  net_cents              bigint NOT NULL DEFAULT 0,
  reason                 text,
  created_by             uuid,
  created_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_subscription_changes_tenant ON subscription_changes (tenant_id, created_at DESC);
