-- 361_community_critical_sms.sql — additive: the explicit opt-in for SMS delivery of CRITICAL safety alerts.
-- The spec requires SMS be used "only for critical alerts when explicitly enabled", so this defaults to FALSE:
-- a tenant receives critical alerts by email until it deliberately turns SMS on. Nullable/defaulted, so it
-- cannot affect existing rows.
ALTER TABLE tenant_community_settings
  ADD COLUMN IF NOT EXISTS critical_sms_enabled BOOLEAN NOT NULL DEFAULT false;
