-- 323_referral_redemptions.sql — salon referral program: track when a customer's referral code brings in a
-- new customer, and whether the referrer's reward has been issued. The referral CODES themselves live in
-- customer_referrals (migration 046); this table records REDEMPTIONS/conversions and reward status. Money is
-- integer cents. A given referred customer can only be referred once per tenant.
CREATE TABLE IF NOT EXISTS referral_redemptions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL,
  referrer_customer_id   UUID NOT NULL,
  referred_customer_id   UUID,
  code                   TEXT NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'pending',   -- pending | rewarded | void
  reward_cents           BIGINT NOT NULL DEFAULT 0,
  redeemed_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  rewarded_at            TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS ix_referral_redemptions_tenant_referrer
  ON referral_redemptions (tenant_id, referrer_customer_id);

-- A customer can only be referred once per tenant.
CREATE UNIQUE INDEX IF NOT EXISTS ux_referral_redemptions_referred
  ON referral_redemptions (tenant_id, referred_customer_id)
  WHERE referred_customer_id IS NOT NULL;
