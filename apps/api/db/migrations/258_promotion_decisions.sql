-- 178_promotion_decisions.sql — persist the reviewer decision trail for approve / reject / disable actions so the
-- management flow preserves who decided, when, and why (audit-ready). Additive; safe to run after 177.
ALTER TABLE tenant_promotions ADD COLUMN IF NOT EXISTS decision_reason TEXT;
ALTER TABLE tenant_promotions ADD COLUMN IF NOT EXISTS reviewed_by UUID;
ALTER TABLE tenant_promotions ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
