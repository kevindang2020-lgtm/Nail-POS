-- 432: drop the exact-duplicate index found by the §7 index audit (DB_INDEX_AUDIT.md, 2026-07-30).
-- merchant_risk_reviews carried TWO identical non-unique btrees on (tenant_id, reviewed_at DESC):
--   idx_merchant_risk_reviews_tenant_reviewed  (kept)
--   idx_merchant_risk_tenant                   (dropped here — created by 187_dispute_surface.sql)
-- Identical definitions serve identically; this is pure write amplification. Report-only policy exception:
-- exact duplicates are provably redundant without production measurement.
DROP INDEX IF EXISTS idx_merchant_risk_tenant;
