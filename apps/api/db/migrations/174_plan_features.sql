-- 174_plan_features.sql — per-plan feature entitlements. state: enabled (included & on) | available (includable) |
-- addon (purchasable add-on) | unavailable. Seeded with each plan's INCLUDED (enabled) features as editable rows;
-- higher tiers are supersets. The Feature Access / adoption units layer tenant overrides + usage on top.

CREATE TABLE IF NOT EXISTS plan_features (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id     uuid NOT NULL REFERENCES subscription_plans (id) ON DELETE CASCADE,
  feature_key text NOT NULL,
  state       text NOT NULL DEFAULT 'unavailable',  -- enabled|available|addon|unavailable
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_id, feature_key)
);

CREATE INDEX IF NOT EXISTS idx_plan_features_plan ON plan_features (plan_id);

INSERT INTO plan_features (plan_id, feature_key, state)
SELECT p.id, v.feature_key, 'enabled'
FROM (VALUES
  -- base (all plans)
  ('starter','pos_core'),('starter','booking'),('starter','check_in'),('starter','queue'),('starter','payments'),('starter','reports'),
  -- professional = base + growth
  ('professional','pos_core'),('professional','booking'),('professional','check_in'),('professional','queue'),('professional','payments'),('professional','reports'),
  ('professional','memberships'),('professional','loyalty'),('professional','communications'),('professional','marketing'),('professional','smart_reminders'),
  -- premium = professional + AI/automation/multi-location
  ('premium','pos_core'),('premium','booking'),('premium','check_in'),('premium','queue'),('premium','payments'),('premium','reports'),
  ('premium','memberships'),('premium','loyalty'),('premium','communications'),('premium','marketing'),('premium','smart_reminders'),
  ('premium','ai_receptionist'),('premium','ai_insights'),('premium','automation'),('premium','multi_location'),
  -- enterprise = premium + security/integrations/priority support
  ('enterprise','pos_core'),('enterprise','booking'),('enterprise','check_in'),('enterprise','queue'),('enterprise','payments'),('enterprise','reports'),
  ('enterprise','memberships'),('enterprise','loyalty'),('enterprise','communications'),('enterprise','marketing'),('enterprise','smart_reminders'),
  ('enterprise','ai_receptionist'),('enterprise','ai_insights'),('enterprise','automation'),('enterprise','multi_location'),
  ('enterprise','advanced_security'),('enterprise','integrations'),('enterprise','priority_support'),
  -- unlimited = everything
  ('unlimited','pos_core'),('unlimited','booking'),('unlimited','check_in'),('unlimited','queue'),('unlimited','payments'),('unlimited','reports'),
  ('unlimited','memberships'),('unlimited','loyalty'),('unlimited','communications'),('unlimited','marketing'),('unlimited','smart_reminders'),
  ('unlimited','ai_receptionist'),('unlimited','ai_insights'),('unlimited','automation'),('unlimited','multi_location'),
  ('unlimited','advanced_security'),('unlimited','integrations'),('unlimited','priority_support')
) AS v(code, feature_key)
JOIN subscription_plans p ON p.code = v.code
ON CONFLICT (plan_id, feature_key) DO NOTHING;
