-- 319_salon_promotions.sql — tenant salon promotions / coupon codes (customer-facing discounts).
-- DISTINCT from the platform `promotions` table (subscription-billing discount codes) and the
-- platform promotions module. Money is integer cents. Tenant-scoped; branch_id NULL = all branches.
CREATE TABLE IF NOT EXISTS salon_promotions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL,
  branch_id          UUID,                               -- NULL = all branches
  code               TEXT NOT NULL,
  name               TEXT NOT NULL,
  discount_type      TEXT NOT NULL CHECK (discount_type IN ('percent','fixed')),
  discount_percent   INTEGER,                            -- 1..100 when discount_type = 'percent'
  discount_cents     BIGINT,                             -- integer cents when discount_type = 'fixed'
  min_purchase_cents BIGINT NOT NULL DEFAULT 0,
  status             TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('draft','active','paused','expired','archived')),
  starts_at          TIMESTAMPTZ,
  ends_at            TIMESTAMPTZ,
  max_redemptions    INTEGER,                            -- NULL = unlimited
  redemption_count   INTEGER NOT NULL DEFAULT 0,
  created_by_user_id UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS salon_promotions_tenant_code ON salon_promotions (tenant_id, lower(code));
CREATE INDEX IF NOT EXISTS salon_promotions_tenant_status ON salon_promotions (tenant_id, status);
