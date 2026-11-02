-- 555_plan_add_on_features.sql — BUILD_PLAN Phase 12 (Constitution 5, #13 feature entitlements).
--
-- The plan-feature guard (@RequireFeature, packages/permissions) decides "may this salon use feature X?" from the
-- plan (plan_features), the salon's ADD-ONS, its Super Admin override (tenant_feature_overrides) and the platform
-- registry (platform_features). plan_add_ons had no link to a feature: an add-on could be sold and invoiced, but nothing
-- could say WHICH feature it unlocks. This adds that link (nullable — an add-on such as extra storage unlocks no
-- feature) and fills it for the seeded add-ons whose code IS a plan feature key. Nothing else changes: an add-on with
-- no feature_key grants nothing, exactly as before.
ALTER TABLE plan_add_ons ADD COLUMN IF NOT EXISTS feature_key TEXT NULL;

-- The guard asks "does an ACTIVE add-on of this salon grant this feature?" — tenant-leading, then the add-on.
CREATE INDEX IF NOT EXISTS idx_tenant_add_ons_tenant_status ON tenant_add_ons (tenant_id, status, add_on_id);
CREATE INDEX IF NOT EXISTS idx_plan_add_ons_feature_key ON plan_add_ons (feature_key) WHERE feature_key IS NOT NULL;

-- Seeded add-ons (migration 178) → the plan feature they unlock (migration 174 keys). 'advanced_analytics' and
-- 'extra_storage_50' name no plan feature and stay NULL.
UPDATE plan_add_ons SET feature_key = v.feature_key
FROM (VALUES ('ai_receptionist', 'ai_receptionist'), ('marketing_suite', 'marketing'), ('priority_support', 'priority_support')) AS v(code, feature_key)
WHERE plan_add_ons.code = v.code AND plan_add_ons.feature_key IS NULL;
