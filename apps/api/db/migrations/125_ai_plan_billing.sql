-- 125_ai_plan_billing.sql — annual billing period + trial→paid conversion support for AI plans. Additive only.
-- billing_period: each plan subscription is monthly or yearly (mirrors tenant_ai_subscriptions). trial_ends_at lets a
-- trial be auto-converted when it lapses. current_period_* track the active paid window. annual_months on the plan
-- settings is how many months are charged on an annual plan (e.g. 10 = "2 months free"); 12 = no annual discount.

ALTER TABLE tenant_ai_plan_subscriptions
  ADD COLUMN IF NOT EXISTS billing_period            TEXT NOT NULL DEFAULT 'monthly' CHECK (billing_period IN ('monthly','yearly')),
  ADD COLUMN IF NOT EXISTS trial_ends_at             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS current_period_starts_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS current_period_ends_at    TIMESTAMPTZ;

ALTER TABLE ai_plan_settings
  ADD COLUMN IF NOT EXISTS annual_months INTEGER NOT NULL DEFAULT 12;

CREATE INDEX IF NOT EXISTS idx_ai_plan_subs_trial ON tenant_ai_plan_subscriptions (status, trial_ends_at);
