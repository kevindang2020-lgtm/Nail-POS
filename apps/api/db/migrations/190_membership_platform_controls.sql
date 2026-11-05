-- 190_membership_platform_controls.sql — Super Admin platform controls for Membership Programs: a singleton platform
-- config (feature gating by subscription plan, platform limits, allowed rules) and a reusable template catalog tenants
-- can copy. Money is integer cents. These are platform-level defaults/guardrails; tenants still build their own plans.

CREATE TABLE IF NOT EXISTS membership_platform_config (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton          BOOLEAN NOT NULL DEFAULT true,
  enabled_globally   BOOLEAN NOT NULL DEFAULT true,
  plan_gating        JSONB NOT NULL DEFAULT '{}'::jsonb,   -- { subscriptionPlanCode: boolean }
  limits             JSONB NOT NULL DEFAULT '{}'::jsonb,   -- { maxProgramsPerTenant, maxActiveMembersPerTenant, maxBenefitsPerProgram, maxTrialDays }
  rules              JSONB NOT NULL DEFAULT '{}'::jsonb,   -- { allowedBillingIntervals[], allowTrials, allowFamily, requireAutoRenewConsent, maxDiscountPercent }
  updated_by_user_id UUID,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_membership_platform_config_singleton ON membership_platform_config (singleton);

CREATE TABLE IF NOT EXISTS membership_templates (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name               TEXT NOT NULL,
  description        TEXT,
  product_type       TEXT NOT NULL DEFAULT 'nail',
  billing_interval   TEXT NOT NULL DEFAULT 'month',
  interval_count     INTEGER NOT NULL DEFAULT 1,
  price_cents        BIGINT NOT NULL DEFAULT 0,
  trial_days         INTEGER NOT NULL DEFAULT 0,
  benefits           JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{ benefitType, label, creditsPerCycle, valueCents, percent }]
  status             TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  version            INTEGER NOT NULL DEFAULT 1,
  created_by_user_id UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_membership_templates_status ON membership_templates (status, updated_at DESC);

-- Seed the singleton config with sensible platform defaults + gating for the current subscription plans.
INSERT INTO membership_platform_config (singleton, enabled_globally, plan_gating, limits, rules)
SELECT true, true,
  (SELECT COALESCE(jsonb_object_agg(code, code <> 'starter'), '{}'::jsonb) FROM subscription_plans),
  jsonb_build_object('maxProgramsPerTenant', 25, 'maxActiveMembersPerTenant', 5000, 'maxBenefitsPerProgram', 12, 'maxTrialDays', 30),
  jsonb_build_object('allowedBillingIntervals', jsonb_build_array('month','quarter','year'), 'allowTrials', true, 'allowFamily', true, 'requireAutoRenewConsent', true, 'maxDiscountPercent', 50)
WHERE NOT EXISTS (SELECT 1 FROM membership_platform_config);

-- Seed two starter templates tenants can copy.
INSERT INTO membership_templates (name, description, product_type, billing_interval, price_cents, trial_days, benefits, status)
SELECT * FROM (VALUES
  ('Basic Nail Membership', 'One manicure each month', 'nail', 'month', 4900::bigint, 0, '[{"benefitType":"service_credit","label":"1 manicure / month","creditsPerCycle":1,"valueCents":4900,"percent":0}]'::jsonb, 'published'),
  ('VIP Membership', 'Monthly service credit and priority booking', 'premium', 'month', 9900::bigint, 14, '[{"benefitType":"service_credit","label":"Monthly service credit","creditsPerCycle":1,"valueCents":9900,"percent":0},{"benefitType":"product_discount","label":"10% product discount","creditsPerCycle":0,"valueCents":0,"percent":10}]'::jsonb, 'published')
) AS v(name, description, product_type, billing_interval, price_cents, trial_days, benefits, status)
WHERE NOT EXISTS (SELECT 1 FROM membership_templates);
