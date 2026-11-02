-- 257_promotions.sql (orig 177_promotions) — tenant-domain promotion + redemption foundation. RENAMED tables
-- tenant_promotions / tenant_promotion_redemptions in the seven-package merge: the platform BILLING domain already
-- owns promotions/promotion_redemptions (178_plan_addons_promotions_trials — subscription-plan promos). Keeping the
-- domains in separate tables preserves the merchant-vs-platform-billing boundary. (previously only marketing `campaigns` existed).
-- Money is integer cents. Discount is calculated SERVER-SIDE from these columns; the client never supplies an amount.
-- Redemptions are enforced atomically: the UNIQUE (promotion_id, idempotency_key) guarantees a retry can never create a
-- second redemption, and per-scope counts are checked inside the redeem transaction. Disabling preserves history.
CREATE TABLE IF NOT EXISTS tenant_promotions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL,
  branch_id          UUID,
  owner_type         TEXT NOT NULL DEFAULT 'tenant' CHECK (owner_type IN ('tenant','platform')),
  name               TEXT NOT NULL,
  promotion_type     TEXT NOT NULL
                       CHECK (promotion_type IN ('percentage','fixed_amount','buy_x_get_y','bundle','free_service','free_product','package','new_client','platform_sponsored')),
  discount_value     INTEGER NOT NULL DEFAULT 0,          -- percentage: basis points-free integer % ; fixed: cents
  max_discount_cents INTEGER,                             -- optional cap for percentage
  min_purchase_cents INTEGER NOT NULL DEFAULT 0,
  currency           TEXT NOT NULL DEFAULT 'USD',
  start_at           TIMESTAMPTZ,
  end_at             TIMESTAMPTZ,
  customer_limit     INTEGER NOT NULL DEFAULT 0,          -- 0 = unlimited
  branch_limit       INTEGER NOT NULL DEFAULT 0,
  tenant_limit       INTEGER NOT NULL DEFAULT 0,
  global_limit       INTEGER NOT NULL DEFAULT 0,
  stacking_policy    TEXT NOT NULL DEFAULT 'none' CHECK (stacking_policy IN ('none','best_only','priority','approved_categories')),
  approval_required  BOOLEAN NOT NULL DEFAULT FALSE,
  approval_status    TEXT NOT NULL DEFAULT 'not_required' CHECK (approval_status IN ('not_required','pending','approved','rejected')),
  status             TEXT NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft','pending_approval','approved','scheduled','active','paused','completed','expired','disabled','rejected','cancelled','archived')),
  disabled_at        TIMESTAMPTZ,
  disabled_reason    TEXT,
  created_by         UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_promotions_tenant ON tenant_promotions (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_promotions_owner ON tenant_promotions (owner_type, status);
CREATE INDEX IF NOT EXISTS idx_promotions_dates ON tenant_promotions (start_at, end_at);

CREATE TABLE IF NOT EXISTS tenant_promotion_redemptions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promotion_id          UUID NOT NULL REFERENCES tenant_promotions (id) ON DELETE CASCADE,
  tenant_id             UUID NOT NULL,
  branch_id             UUID,
  customer_id           UUID,
  ticket_id             UUID,
  checkout_id           UUID,
  eligible_subtotal_cents INTEGER NOT NULL DEFAULT 0,
  discount_cents        INTEGER NOT NULL DEFAULT 0,       -- server-computed
  final_subtotal_cents  INTEGER NOT NULL DEFAULT 0,
  currency              TEXT NOT NULL DEFAULT 'USD',
  status                TEXT NOT NULL DEFAULT 'redeemed' CHECK (status IN ('redeemed','reversed','partially_reversed','void')),
  idempotency_key       TEXT NOT NULL,
  rule_version          INTEGER NOT NULL DEFAULT 1,
  redeemed_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  reversed_at           TIMESTAMPTZ,
  reversal_reason       TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT promotion_redemptions_idem UNIQUE (promotion_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_promo_redemptions_promo ON tenant_promotion_redemptions (promotion_id, status);
CREATE INDEX IF NOT EXISTS idx_promo_redemptions_customer ON tenant_promotion_redemptions (promotion_id, customer_id) WHERE status = 'redeemed';
CREATE INDEX IF NOT EXISTS idx_promo_redemptions_tenant ON tenant_promotion_redemptions (tenant_id, redeemed_at);
