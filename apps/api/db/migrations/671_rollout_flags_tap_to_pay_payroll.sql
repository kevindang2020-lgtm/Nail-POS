-- 671_rollout_flags_tap_to_pay_payroll.sql — Oct 14 build plan §208 ("flags mobile_tap_to_pay / new_payroll_engine"), rebuilt
-- Oct 21 2026. Two ROLLOUT flags in the one feature registry (Constitution 7 §30–§33 + the per-flag rollout policy of
-- platform_flag_rollouts, migration 551): Super Admin can roll them out by percentage / allow-list, deny a salon, or kill
-- them — without a redeploy.
--   mobile_tap_to_pay   the Tap-to-Pay path of the mobile checkout (proceed-to-payment refuses with the flag's reason)
--   new_payroll_engine  the ONE-PAY compensation / payroll engine's LOCK (approve) of a pay period (preview still works)
-- Both AVAILABLE by default (a salon is in unless a policy says otherwise) — the flag is a safety valve, not a launch gate.
INSERT INTO platform_features (feature_key, name, description, category, status, requires_configuration, platform_kill_switch_supported, kill_switch_key) VALUES
  ('mobile_tap_to_pay',  'Mobile Tap to Pay',  'Tap to Pay on the manager''s phone (mobile checkout). Roll out, deny a salon, or kill here.', 'payments', 'AVAILABLE', true,  true, 'payments.tap_to_pay'),
  ('new_payroll_engine', 'Payroll engine lock', 'Approving (locking) a pay period on the compensation engine. Kill here to hold every salon''s payroll lock.', 'workforce', 'AVAILABLE', false, false, NULL)
ON CONFLICT (feature_key) DO NOTHING;
