-- 173_subscription_plans_seed.sql — canonical default plan catalog (Starter/Professional/Premium/Enterprise/Unlimited)
-- and the 13 configurable per-plan limits each. Idempotent (ON CONFLICT DO NOTHING) so it is safe to re-run and so a
-- Super Admin's later edits to these rows are never overwritten. NULL limit_value = unlimited. Money in integer cents.

INSERT INTO subscription_plans (code, name, subtitle, plan_type, status, monthly_price_cents, annual_price_cents, is_recommended, is_public, display_order)
VALUES
  ('starter',      'Starter',      'Free Trial',           'standard',  'active',     0,        0,        false, true, 1),
  ('professional', 'Professional', NULL,                   'standard',  'active',  9900,   106920,        false, true, 2),
  ('premium',      'Premium',      'Most Popular',         'standard',  'active', 19900,   214920,        true,  true, 3),
  ('enterprise',   'Enterprise',   NULL,                   'enterprise','active', 39900,   430920,        false, true, 4),
  ('unlimited',    'Unlimited',    'Unlimited Everything', 'unlimited', 'active', 69900,   754920,        false, true, 5)
ON CONFLICT (code) DO NOTHING;

-- Per-plan limits. (metric, value) — NULL value = unlimited. Soft/hard + overage default conservatively (hard, no overage);
-- the Overage Rules unit will layer per-metric overage pricing on top.
INSERT INTO plan_limits (plan_id, metric, limit_value)
SELECT p.id, v.metric, v.limit_value
FROM (VALUES
  -- Starter
  ('starter','branches',1),('starter','users',2),('starter','technicians',2),('starter','customers',500),
  ('starter','appointments_monthly',500),('starter','sms_monthly',100),('starter','email_monthly',200),
  ('starter','ai_minutes_monthly',300),('starter','ai_receptionist_calls_monthly',50),('starter','storage_gb',2),
  ('starter','devices',1),('starter','integrations',2),('starter','report_retention_days',30),
  -- Professional
  ('professional','branches',3),('professional','users',10),('professional','technicians',8),('professional','customers',2500),
  ('professional','appointments_monthly',2000),('professional','sms_monthly',1000),('professional','email_monthly',2000),
  ('professional','ai_minutes_monthly',2500),('professional','ai_receptionist_calls_monthly',200),('professional','storage_gb',10),
  ('professional','devices',3),('professional','integrations',5),('professional','report_retention_days',90),
  -- Premium
  ('premium','branches',10),('premium','users',20),('premium','technicians',15),('premium','customers',5000),
  ('premium','appointments_monthly',5000),('premium','sms_monthly',2500),('premium','email_monthly',5000),
  ('premium','ai_minutes_monthly',5000),('premium','ai_receptionist_calls_monthly',500),('premium','storage_gb',25),
  ('premium','devices',5),('premium','integrations',10),('premium','report_retention_days',180),
  -- Enterprise
  ('enterprise','branches',25),('enterprise','users',50),('enterprise','technicians',40),('enterprise','customers',10000),
  ('enterprise','appointments_monthly',10000),('enterprise','sms_monthly',5000),('enterprise','email_monthly',10000),
  ('enterprise','ai_minutes_monthly',10000),('enterprise','ai_receptionist_calls_monthly',1000),('enterprise','storage_gb',50),
  ('enterprise','devices',10),('enterprise','integrations',20),('enterprise','report_retention_days',365),
  -- Unlimited (NULL = unlimited; storage capped at a configurable 250 GB)
  ('unlimited','branches',NULL),('unlimited','users',NULL),('unlimited','technicians',NULL),('unlimited','customers',NULL),
  ('unlimited','appointments_monthly',NULL),('unlimited','sms_monthly',NULL),('unlimited','email_monthly',NULL),
  ('unlimited','ai_minutes_monthly',NULL),('unlimited','ai_receptionist_calls_monthly',NULL),('unlimited','storage_gb',250),
  ('unlimited','devices',NULL),('unlimited','integrations',NULL),('unlimited','report_retention_days',NULL)
) AS v(code, metric, limit_value)
JOIN subscription_plans p ON p.code = v.code
ON CONFLICT (plan_id, metric) DO NOTHING;
