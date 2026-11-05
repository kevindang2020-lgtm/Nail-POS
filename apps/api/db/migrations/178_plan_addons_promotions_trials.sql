-- 178_plan_addons_promotions_trials.sql — add-ons, promotions, trials, and grandfathering data model for Plans &
-- Feature Limits. Money is integer cents (BIGINT). Catalog rows are seeded as editable configuration; tenant-linkage
-- tables (subscriptions/redemptions/assignments) start empty so counts/revenue render honestly until real data exists.

-- ---- Add-ons ----
CREATE TABLE IF NOT EXISTS plan_add_ons (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code             text NOT NULL UNIQUE,
  name             text NOT NULL,
  description      text,
  pricing_model    text NOT NULL DEFAULT 'monthly',   -- one_time|monthly|annual|quantity|usage
  unit_price_cents bigint NOT NULL DEFAULT 0,
  billing_interval text NOT NULL DEFAULT 'monthly',
  prerequisite_plan_code text,
  status           text NOT NULL DEFAULT 'active',     -- active|inactive|archived
  display_order    int NOT NULL DEFAULT 0,
  effective_from   timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant_add_ons (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  add_on_id    uuid NOT NULL REFERENCES plan_add_ons (id) ON DELETE CASCADE,
  quantity     int NOT NULL DEFAULT 1,
  price_cents  bigint NOT NULL,                         -- effective (possibly custom) price
  status       text NOT NULL DEFAULT 'active',          -- active|cancelled
  started_at   timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, add_on_id)
);
CREATE INDEX IF NOT EXISTS idx_tenant_add_ons_addon ON tenant_add_ons (add_on_id);

-- ---- Promotions ----
CREATE TABLE IF NOT EXISTS promotions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                text NOT NULL UNIQUE,
  name                text NOT NULL,
  discount_type       text NOT NULL,                    -- percent|fixed|free_period
  discount_percent    int,                              -- for percent
  discount_cents      bigint,                           -- for fixed
  free_months         int,                              -- for free_period
  eligible_plan_codes text,                             -- comma-separated; NULL = all
  start_date          timestamptz NOT NULL DEFAULT now(),
  end_date            timestamptz,
  max_redemptions     int,
  per_tenant_limit    int NOT NULL DEFAULT 1,
  new_tenant_only     boolean NOT NULL DEFAULT false,
  stackable           boolean NOT NULL DEFAULT false,
  conversion_plan_code text,
  status              text NOT NULL DEFAULT 'active',    -- draft|active|expired|archived
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS promotion_redemptions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promotion_id uuid NOT NULL REFERENCES promotions (id) ON DELETE CASCADE,
  tenant_id    uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  redeemed_at  timestamptz NOT NULL DEFAULT now(),
  status       text NOT NULL DEFAULT 'active'
);
CREATE INDEX IF NOT EXISTS idx_promo_redemptions_promo ON promotion_redemptions (promotion_id);

-- ---- Trials ----
CREATE TABLE IF NOT EXISTS trial_definitions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                text NOT NULL UNIQUE,
  name                text NOT NULL,
  plan_id             uuid REFERENCES subscription_plans (id) ON DELETE SET NULL,
  duration_days       int NOT NULL,
  payment_required    boolean NOT NULL DEFAULT false,
  conversion_plan_id  uuid REFERENCES subscription_plans (id) ON DELETE SET NULL,
  expiration_behavior text NOT NULL DEFAULT 'manual',    -- convert|read_only|grace|paused|manual
  status              text NOT NULL DEFAULT 'active',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant_trials (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  trial_definition_id uuid NOT NULL REFERENCES trial_definitions (id) ON DELETE CASCADE,
  started_at         timestamptz NOT NULL DEFAULT now(),
  ends_at            timestamptz NOT NULL,
  status             text NOT NULL DEFAULT 'active',     -- active|converted|expired|cancelled
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tenant_trials_def ON tenant_trials (trial_definition_id);

-- ---- Grandfathering ----
CREATE TABLE IF NOT EXISTS grandfathered_assignments (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  plan_version_id           uuid REFERENCES subscription_plan_versions (id) ON DELETE SET NULL,
  locked_monthly_price_cents bigint,
  effective_from            timestamptz NOT NULL DEFAULT now(),
  end_date                  timestamptz,
  migration_target_plan_code text,
  reason                    text,
  created_by                uuid,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id)
);

-- ---- Seed configurable catalog (idempotent) ----
INSERT INTO plan_add_ons (code, name, description, pricing_model, unit_price_cents, prerequisite_plan_code, display_order)
VALUES
  ('ai_receptionist',   'AI Receptionist',      'AI receptionist call handling',     'monthly', 4900, NULL, 1),
  ('advanced_analytics','Advanced Analytics',   'Deeper reporting & dashboards',     'monthly', 2900, NULL, 2),
  ('marketing_suite',   'Marketing Suite',      'Campaigns & growth tools',          'monthly', 3900, NULL, 3),
  ('extra_storage_50',  'Extra Storage (50 GB)','Additional 50 GB of storage',       'monthly', 1900, NULL, 4),
  ('priority_support',  'Priority Support',     'Priority support SLA',              'monthly', 2900, NULL, 5)
ON CONFLICT (code) DO NOTHING;

INSERT INTO trial_definitions (code, name, plan_id, duration_days, conversion_plan_id, expiration_behavior)
SELECT v.code, v.name, p.id, v.days, cp.id, 'convert'
FROM (VALUES
  ('starter_trial_7',      'Starter Trial (7 Days)',      'starter',      7,  'starter'),
  ('professional_trial_14','Professional Trial (14 Days)','professional', 14, 'professional'),
  ('premium_trial_14',     'Premium Trial (14 Days)',     'premium',      14, 'premium')
) AS v(code, name, plan_code, days, conv_code)
LEFT JOIN subscription_plans p  ON p.code = v.plan_code
LEFT JOIN subscription_plans cp ON cp.code = v.conv_code
ON CONFLICT (code) DO NOTHING;

INSERT INTO promotions (code, name, discount_type, discount_percent, free_months, eligible_plan_codes, end_date, status)
VALUES
  ('spring_20', 'Spring Promo – 20% Off', 'percent', 20, NULL, NULL, now() + interval '60 days', 'active'),
  ('unlimited_2mo_free', 'Unlimited – 2 Months Free', 'free_period', NULL, 2, 'unlimited', now() + interval '90 days', 'active')
ON CONFLICT (code) DO NOTHING;
