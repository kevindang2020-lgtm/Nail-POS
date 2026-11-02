-- 471_platform_features.sql — Constitution 7 §30–§33: ONE feature definition registry. Every platform feature has a stable
-- key, metadata (§31) and a STATUS (§33 — not one boolean). Plans (plan_features) and tenant overrides keep deciding
-- entitlement; the registry adds the platform layer above them, and a feature that supports it names the kill switch
-- (the §34 centre) that can emergency-disable it.
CREATE TABLE IF NOT EXISTS platform_features (
  feature_key                      TEXT PRIMARY KEY,
  name                             TEXT NOT NULL,
  description                      TEXT NOT NULL DEFAULT '',
  category                         TEXT NOT NULL,
  status                           TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE','BETA','DISABLED','DEPRECATED','EMERGENCY_DISABLED')),
  minimum_plan                     TEXT NULL,
  requires_configuration           BOOLEAN NOT NULL DEFAULT false,
  platform_kill_switch_supported   BOOLEAN NOT NULL DEFAULT false,
  kill_switch_key                  TEXT NULL,
  created_at                       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT platform_features_kill_switch_named CHECK (NOT platform_kill_switch_supported OR kill_switch_key IS NOT NULL)
);
-- §30's examples, each with the kill switch that covers it (where one exists)
INSERT INTO platform_features (feature_key, name, category, requires_configuration, platform_kill_switch_supported, kill_switch_key) VALUES
  ('ai_receptionist',           'AI Receptionist',            'ai',          true,  false, NULL),
  ('deals_engine',              'Deals Engine',               'marketing',   false, true,  'deals.engine'),
  ('ai_forecasting',            'AI Forecasting',             'ai',          false, false, NULL),
  ('booking_phone_verification','Booking phone verification', 'booking',     true,  true,  'booking.verification'),
  ('ai_review_reputation',      'AI Review & Reputation',     'ai',          false, false, NULL),
  ('ai_scheduling_optimizer',   'AI Scheduling Optimizer',    'ai',          false, true,  'ai.auto_actions'),
  ('ai_queue_assignment',       'AI Queue Assignment',        'ai',          false, true,  'ai.auto_actions'),
  ('ai_ocr_receipt',            'AI Receipt OCR',             'ai',          false, false, NULL),
  ('ai_deposit_reconciliation', 'AI Deposit Reconciliation',  'payments',    true,  false, NULL),
  ('advanced_reports',          'Advanced Reports',           'analytics',   false, false, NULL),
  ('multi_branch',              'Multi-Branch',               'operations',  false, false, NULL),
  ('customer_app',              'Customer App',               'apps',        false, false, NULL),
  ('owner_app',                 'Owner App',                  'apps',        false, false, NULL),
  ('technician_app',            'Technician App',             'apps',        false, false, NULL)
ON CONFLICT (feature_key) DO NOTHING;
