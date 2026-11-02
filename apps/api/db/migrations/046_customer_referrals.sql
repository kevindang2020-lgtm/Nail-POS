-- 046_customer_referrals.sql — one stable referral code per customer (Home → Refer a Friend). Tenant + customer scoped;
-- the code is generated on first request and reused thereafter. Code is globally unique.
CREATE TABLE IF NOT EXISTS customer_referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  customer_id UUID NOT NULL,
  code TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_referrals_customer ON customer_referrals (tenant_id, customer_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_referrals_code ON customer_referrals (code);
