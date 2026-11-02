-- 738_promotion_eligibility_checks.sql — Promotions Management guide (30 Oct 2026) §05 search scope "Eligibility Checks" and
-- §11 Smart Promotion Eligibility Checker. ADDITIVE, insert-only.
--
--   promotion_eligibility_checks  one row per Check Promotion run: which promotion, for which ticket / customer (when given),
--                                 the verdict Checkout's own engine returned, its reasons and the discount it WOULD take.
--                                 A check never consumes a use, never reserves, never sends and never charges — this row is
--                                 the only thing it writes. Redemption History stays the deal_redemptions ledger; a customer
--                                 appears under "Eligibility Checks" only because a person actually checked them.
-- Rows are never updated or deleted by the application. Tenant-scoped; branch is the checking session's branch.

CREATE TABLE IF NOT EXISTS promotion_eligibility_checks (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID NOT NULL REFERENCES tenants(id),
  branch_id               UUID REFERENCES branches(id),
  deal_id                 UUID NOT NULL REFERENCES deals(id),
  ticket_id               UUID REFERENCES tickets(id),
  customer_id             UUID REFERENCES customers(id),
  verdict                 TEXT NOT NULL,
  eligible                BOOLEAN NOT NULL,
  reasons_json            JSONB NOT NULL DEFAULT '[]'::jsonb,       -- [{code, message}] exactly as Checkout's engine returned them
  spend_cents             BIGINT CHECK (spend_cents IS NULL OR spend_cents >= 0),
  eligible_base_cents     BIGINT CHECK (eligible_base_cents IS NULL OR eligible_base_cents >= 0),
  discount_preview_cents  BIGINT CHECK (discount_preview_cents IS NULL OR discount_preview_cents >= 0),
  source                  TEXT NOT NULL DEFAULT 'promotions' CHECK (source IN ('promotions', 'coupons', 'deals')),
  created_by_user_id      UUID,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_promo_checks_tenant ON promotion_eligibility_checks (tenant_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_promo_checks_deal ON promotion_eligibility_checks (tenant_id, deal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_promo_checks_customer ON promotion_eligibility_checks (tenant_id, customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_promo_checks_ticket ON promotion_eligibility_checks (tenant_id, ticket_id) WHERE ticket_id IS NOT NULL;
