-- 737_deals_offers_indexes.sql — Deals & Offers guide (30 Oct 2026) §17 "DB indexes for tenant + status + timestamp and
-- scoped customer lookup". ADDITIVE: indexes only, no table or data change (rollback = DROP INDEX, nothing else).
--
--   ix_deals_tenant_created          the library's default order (newest created first, id tie-breaker) per salon
--   ix_deal_redemptions_tenant_at    Redemption History newest first per salon (redeemed / applied / created time)
--   ix_deal_redemptions_tenant_cust  a customer's deal history and customer-name / phone searches joined per salon
--   ix_deal_approvals_tenant_time    the approval inbox and the Approved date basis per salon

CREATE INDEX IF NOT EXISTS ix_deals_tenant_created ON deals (tenant_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS ix_deal_redemptions_tenant_at ON deal_redemptions (tenant_id, (coalesce(redeemed_at, applied_at, created_at)) DESC, id DESC);
CREATE INDEX IF NOT EXISTS ix_deal_redemptions_tenant_cust ON deal_redemptions (tenant_id, customer_id);
CREATE INDEX IF NOT EXISTS ix_deal_approvals_tenant_time ON deal_approvals (tenant_id, created_at DESC);
