-- 048_loyalty_rewards.sql — redeemable loyalty rewards catalog + redemption log (tenant-scoped). Points are deducted
-- atomically from customer_loyalty_profiles.points_balance on redeem. No money here — loyalty points only.
CREATE TABLE IF NOT EXISTS loyalty_rewards (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  points_cost INTEGER NOT NULL,
  active      BOOLEAN NOT NULL DEFAULT true,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_loyalty_rewards_tenant ON loyalty_rewards (tenant_id, active, sort_order);

CREATE TABLE IF NOT EXISTS loyalty_redemptions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL,
  customer_id  UUID NOT NULL,
  reward_id    UUID NOT NULL,
  reward_title TEXT NOT NULL,
  points_spent INTEGER NOT NULL,
  code         TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_loyalty_redemptions_customer ON loyalty_redemptions (tenant_id, customer_id, created_at);
