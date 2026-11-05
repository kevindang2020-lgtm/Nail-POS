-- 431_sms_default_package_setting.sql — §41 default package for new tenants (Jul 29, 2026, sms-packages).
-- One more row in the EXISTING platform_settings store (same group as the §40 controls). SAFE default: null —
-- no default package, so deploying this changes nothing. When Super Admin sets a package code here, every tenant
-- created AFTER that moment (direct SA creation AND application approval — both flow through the same
-- createTenant()) is auto-assigned that package with an audited §41 reason.
INSERT INTO platform_settings (setting_key, setting_group, value, value_type, override_policy, is_sensitive, is_mandatory)
VALUES ('sms.default_package_code', 'sms_packages', 'null'::jsonb, 'string', 'mandatory', false, false)
ON CONFLICT (setting_key) DO NOTHING;
