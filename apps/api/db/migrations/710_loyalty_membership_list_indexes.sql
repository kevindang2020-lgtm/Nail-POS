-- migrate: no-transaction
-- 710_loyalty_membership_list_indexes.sql — Loyalty & Rewards and Membership Overview mandates (Oct 29 2026): the
-- newest-first numbered lists (spec §09: ORDER BY created / posted time DESC, unique id DESC) each read one of these.
-- Index-only additions, built CONCURRENTLY so a live salon is never blocked; idempotent.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_loyalty_rewards_tenant_created ON loyalty_rewards (tenant_id, created_at DESC, id DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_loyalty_profiles_tenant_created ON customer_loyalty_profiles (tenant_id, created_at DESC, id DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_loyalty_redemptions_tenant_created ON loyalty_redemptions (tenant_id, created_at DESC, id DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_loyalty_ledger_tenant_created_id ON loyalty_ledger (tenant_id, created_at DESC, id DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_loyalty_ledger_tenant_source ON loyalty_ledger (tenant_id, source_id) WHERE source_id IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customer_memberships_tenant_started ON customer_memberships (tenant_id, started_at DESC, id DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_membership_activity_tenant_occurred ON membership_activity (tenant_id, occurred_at DESC, id DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_membership_redemptions_tenant_created ON membership_redemptions (tenant_id, created_at DESC);
