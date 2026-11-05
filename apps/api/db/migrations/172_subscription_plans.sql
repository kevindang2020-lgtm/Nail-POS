-- 172_subscription_plans.sql — platform subscription-plan catalog + per-plan configurable limits.
-- Foundation for Super Admin → Plans & Feature Limits. Money is integer minor units (cents, BIGINT). A NULL limit_value
-- means "unlimited". These are real, editable rows (not hardcoded business logic) — the catalog a Super Admin manages.

CREATE TABLE IF NOT EXISTS subscription_plans (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                text NOT NULL UNIQUE,                  -- stable machine code, e.g. 'starter'
  name                text NOT NULL,
  subtitle            text,                                  -- e.g. 'Free Trial', 'Unlimited Everything'
  description         text,
  plan_type           text NOT NULL DEFAULT 'standard',      -- standard|trial|promotional|enterprise|unlimited|custom|grandfathered|legacy|internal
  status              text NOT NULL DEFAULT 'draft',         -- draft|scheduled|active|inactive|archived|grandfathered|deprecated
  monthly_price_cents bigint NOT NULL DEFAULT 0,
  annual_price_cents  bigint,
  setup_fee_cents     bigint NOT NULL DEFAULT 0,
  currency            text NOT NULL DEFAULT 'USD',
  billing_interval    text NOT NULL DEFAULT 'monthly',       -- monthly|annual
  is_recommended      boolean NOT NULL DEFAULT false,        -- "Most Popular"
  is_public           boolean NOT NULL DEFAULT true,         -- false => not offered to new tenants (grandfathered/internal)
  display_order       int NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscription_plans_status ON subscription_plans (status);
CREATE INDEX IF NOT EXISTS idx_subscription_plans_type   ON subscription_plans (plan_type);

CREATE TABLE IF NOT EXISTS plan_limits (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id              uuid NOT NULL REFERENCES subscription_plans (id) ON DELETE CASCADE,
  metric               text NOT NULL,                        -- branches|users|technicians|customers|appointments_monthly|sms_monthly|
                                                             -- email_monthly|ai_minutes_monthly|ai_receptionist_calls_monthly|
                                                             -- storage_gb|devices|integrations|report_retention_days
  limit_value          bigint,                               -- NULL = unlimited
  enforcement          text NOT NULL DEFAULT 'hard',         -- soft|hard
  warning_threshold_pct int NOT NULL DEFAULT 90,             -- advisory warning fires at/above this % of limit
  overage_allowed      boolean NOT NULL DEFAULT false,
  overage_price_cents  bigint,                               -- per unit, integer cents (e.g. AI minute = 5, GB = 10, user = 1000)
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_id, metric)
);

CREATE INDEX IF NOT EXISTS idx_plan_limits_plan ON plan_limits (plan_id);
