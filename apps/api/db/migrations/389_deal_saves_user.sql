-- 389_deal_saves_user.sql — a saved deal is a SHOPPER'S personal list (cross-tenant), not a salon's customer record.
-- So saves are keyed by the global user_id, and no per-tenant customers row is created just because someone taps save.
-- deal_saves was introduced in 387 and never populated, so re-keying it here is safe. tenant_id stays (it's the deal's
-- tenant, useful for the salon's own reporting), customer_id becomes optional. Order matters: drop the
-- (deal_id, customer_id) primary key BEFORE relaxing customer_id's NOT NULL.
ALTER TABLE deal_saves DROP CONSTRAINT IF EXISTS deal_saves_pkey;
ALTER TABLE deal_saves ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE deal_saves ALTER COLUMN customer_id DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_deal_saves_user ON deal_saves (deal_id, user_id);
CREATE INDEX IF NOT EXISTS idx_deal_saves_user ON deal_saves (user_id);
