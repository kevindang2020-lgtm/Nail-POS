-- 430_sms_platform_controls.sql — §40 Super Admin master controls (Jul 29, 2026, sms-packages follow-up).
-- NO new table: the platform already has `platform_settings` (migration 202) with a key/group/jsonb/value_type
-- shape and its own Super Admin repository. These four switches are seeded as rows there, so they inherit the
-- existing settings plumbing (versioning, override policy, SA surface) instead of growing a parallel store.
--
-- Defaults are deliberately the SAFE, NON-DISRUPTIVE state: the platform is ON, billing is ON, new-tenant
-- enrollment is ON, and the emergency stop is OFF. Deploying this migration changes no behaviour for anyone.
INSERT INTO platform_settings (setting_key, setting_group, value, value_type, override_policy, is_sensitive, is_mandatory)
VALUES
  ('sms.verification_platform_enabled', 'sms_packages', 'true'::jsonb,  'boolean', 'mandatory', false, false),
  ('sms.package_billing_enabled',       'sms_packages', 'true'::jsonb,  'boolean', 'mandatory', false, false),
  ('sms.new_tenant_enrollment_enabled', 'sms_packages', 'true'::jsonb,  'boolean', 'mandatory', false, false),
  ('sms.emergency_send_disabled',       'sms_packages', 'false'::jsonb, 'boolean', 'mandatory', false, false)
ON CONFLICT (setting_key) DO NOTHING;
