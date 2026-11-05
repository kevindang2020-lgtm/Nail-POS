-- 664_sms_pricing_tiers_guide.sql — Twilio SMS Plans, Pricing & Profit Guide implementation (Oct 15, 2026).
-- Implements the 3 tiers (SMS Essential, SMS Growth, SMS Unlimited Team) + platform unit economics from the client pricing guide.

UPDATE sms_verification_packages 
SET name = 'SMS Essential',
    description = 'For salons with 1-10 technicians. Includes 2,000 regular SMS segments + 100 customer OTP verifications.',
    monthly_price_cents = 7900,
    included_verification_count = 100,
    overage_enabled = true,
    overage_unit_price_cents = 15,
    hard_limit_enabled = false,
    warning_threshold_percent = 75,
    critical_threshold_percent = 90,
    self_service_available = true,
    active = true,
    updated_at = now()
WHERE code = 'sms_starter';

UPDATE sms_verification_packages 
SET name = 'SMS Growth',
    description = 'For salons with 11-20 technicians. Includes 4,000 regular SMS segments + 200 customer OTP verifications.',
    monthly_price_cents = 13900,
    included_verification_count = 200,
    overage_enabled = true,
    overage_unit_price_cents = 15,
    hard_limit_enabled = false,
    warning_threshold_percent = 75,
    critical_threshold_percent = 90,
    self_service_available = true,
    active = true,
    updated_at = now()
WHERE code = 'sms_growth';

UPDATE sms_verification_packages 
SET name = 'SMS Unlimited Team',
    description = 'For salons with unlimited technicians. Includes 7,500 regular SMS segments + 400 customer OTP verifications.',
    monthly_price_cents = 23900,
    included_verification_count = 400,
    overage_enabled = true,
    overage_unit_price_cents = 15,
    hard_limit_enabled = false,
    warning_threshold_percent = 75,
    critical_threshold_percent = 90,
    self_service_available = true,
    active = true,
    updated_at = now()
WHERE code = 'sms_pro';

-- Update platform default package code
UPDATE platform_settings 
SET value = '"sms_starter"'::jsonb, updated_at = now()
WHERE setting_key = 'sms.default_package_code';

-- Ensure marketing segment price setting exists ($0.035 = 3.5 cents)
INSERT INTO platform_settings (setting_key, setting_group, value, value_type, override_policy)
VALUES ('sms.marketing_segment_price_cents', 'sms_packages', '3.5'::jsonb, 'number', 'mandatory')
ON CONFLICT (setting_key) DO UPDATE 
  SET value = EXCLUDED.value, updated_at = now();

-- Add one-time activation fee setting ($49 = 4900 cents)
INSERT INTO platform_settings (setting_key, setting_group, value, value_type, override_policy)
VALUES ('sms.one_time_activation_fee_cents', 'sms_packages', '4900'::jsonb, 'number', 'mandatory')
ON CONFLICT (setting_key) DO UPDATE 
  SET value = EXCLUDED.value, updated_at = now();
