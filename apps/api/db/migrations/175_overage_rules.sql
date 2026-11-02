-- 175_overage_rules.sql — per-metric overage pricing. unit_price_cents is integer cents per unit. plan_id NULL = a
-- platform default applicable to all plans; a non-NULL plan_id overrides for that plan. Seeded with the platform
-- defaults; tenant/revenue figures are NOT stored here (they come from real metered usage in a later unit).

CREATE TABLE IF NOT EXISTS overage_rules (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  metric                  text NOT NULL,
  unit_price_cents        bigint NOT NULL,               -- per unit, integer cents
  grace_amount            bigint NOT NULL DEFAULT 0,
  warning_threshold_pct   int NOT NULL DEFAULT 90,
  hard_stop_threshold_pct int,                            -- NULL = no hard stop (soft/overage)
  billing_period          text NOT NULL DEFAULT 'monthly',
  rounding                text NOT NULL DEFAULT 'up',      -- up|nearest|down
  min_charge_cents        bigint NOT NULL DEFAULT 0,
  max_charge_cents        bigint,                          -- NULL = uncapped
  effective_from          timestamptz NOT NULL DEFAULT now(),
  plan_id                 uuid REFERENCES subscription_plans (id) ON DELETE CASCADE,  -- NULL = all plans
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_overage_rules_metric ON overage_rules (metric);

-- Platform-default overage prices (Section 19). Idempotent via NOT EXISTS on the default (plan_id IS NULL) rows.
INSERT INTO overage_rules (metric, unit_price_cents)
SELECT v.metric, v.unit_price_cents
FROM (VALUES
  ('ai_minutes_monthly', 5),    -- $0.05 / minute
  ('sms_monthly',        1),    -- $0.01 / SMS
  ('storage_gb',        10),    -- $0.10 / GB
  ('users',           1000),    -- $10.00 / user
  ('branches',        2500)     -- $25.00 / branch
) AS v(metric, unit_price_cents)
WHERE NOT EXISTS (
  SELECT 1 FROM overage_rules o WHERE o.metric = v.metric AND o.plan_id IS NULL
);
