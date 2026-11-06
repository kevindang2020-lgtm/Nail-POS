-- 824_loyalty_dual_control.sql — Batch C decision 1 (Kevin, Nov 6 2026: "pick best for my POS").
-- Global loyalty earning-rule publishes and program updates are approvable actions in the platform maker/checker
-- (PlatformApprovals). The policy starts ON: when another active platform account can approve, a second Super Admin must;
-- with no such account the change runs as an audited self-approval (one Super Admin is never locked out). A pause-only
-- program change (the emergency stop) is never held. Super Admin → Approvals → policies can turn either off (audited).
-- ON CONFLICT DO NOTHING: a policy someone already set is never overwritten.
INSERT INTO platform_settings (setting_key, setting_group, value, value_type)
VALUES ('approvals.loyalty.global_rule_publish.required', 'approvals', 'true'::jsonb, 'boolean'),
       ('approvals.loyalty.program_update.required', 'approvals', 'true'::jsonb, 'boolean')
ON CONFLICT (setting_key) DO NOTHING;
