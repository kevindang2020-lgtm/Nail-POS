-- 176_subscription_plan_versions.sql — immutable historical snapshots of a plan's commercial terms. A new version is
-- written on plan creation (v1) and on every pricing change; prior versions are never edited (only their lifecycle
-- status/end_date move to 'superseded'), so historical invoices/usage stay bound to the terms that were in effect.

CREATE TABLE IF NOT EXISTS subscription_plan_versions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id             uuid NOT NULL REFERENCES subscription_plans (id) ON DELETE CASCADE,
  version_number      int NOT NULL,
  monthly_price_cents bigint NOT NULL,
  annual_price_cents  bigint,
  setup_fee_cents     bigint NOT NULL DEFAULT 0,
  currency            text NOT NULL DEFAULT 'USD',
  billing_interval    text NOT NULL DEFAULT 'monthly',
  limits_snapshot     jsonb NOT NULL DEFAULT '{}'::jsonb,   -- { metric: value|null }
  features_snapshot   jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [ { feature_key, state } ]
  status              text NOT NULL DEFAULT 'active',        -- active|superseded|scheduled
  effective_from      timestamptz NOT NULL DEFAULT now(),
  end_date            timestamptz,
  change_reason       text,
  created_by          uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_plan_versions_plan ON subscription_plan_versions (plan_id);

-- Backfill v1 for plans that predate versioning (idempotent).
INSERT INTO subscription_plan_versions
  (plan_id, version_number, monthly_price_cents, annual_price_cents, setup_fee_cents, currency, billing_interval,
   limits_snapshot, features_snapshot, status, change_reason)
SELECT p.id, 1, p.monthly_price_cents, p.annual_price_cents, p.setup_fee_cents, p.currency, p.billing_interval,
  COALESCE((SELECT jsonb_object_agg(l.metric, l.limit_value) FROM plan_limits l WHERE l.plan_id = p.id), '{}'::jsonb),
  COALESCE((SELECT jsonb_agg(jsonb_build_object('feature_key', f.feature_key, 'state', f.state) ORDER BY f.feature_key)
            FROM plan_features f WHERE f.plan_id = p.id), '[]'::jsonb),
  'active', 'Initial version (backfill)'
FROM subscription_plans p
WHERE NOT EXISTS (SELECT 1 FROM subscription_plan_versions v WHERE v.plan_id = p.id);
