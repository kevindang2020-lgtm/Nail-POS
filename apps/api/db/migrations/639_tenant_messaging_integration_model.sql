-- 639_tenant_messaging_integration_model.sql — Payments / Clover / Fiserv / Twilio mandate (Oct 13 2026, wave 3)
-- §56–§60 (tenant Twilio configuration: account mode, Messaging Service), §59 (tenant phone numbers: provider SID,
-- purpose, status), §168 (configuration version).
--
--   tenant_messaging_credentials — the TenantMessagingIntegration (§58). account_mode names whose Twilio account the
--     credentials belong to (§185): 'platform_managed' = an AIPowerSalon subaccount the platform provisions for the salon,
--     'tenant_owned' = the salon brought its own account (every pre-existing row — a salon typed its own SID + token).
--     messaging_service_sid (MG…) = the salon's Messaging Service; when set, sends name it instead of a bare From number
--     (§60 — Twilio picks the sender from the service's pool; A2P campaigns attach to it). config_version bumps on every
--     write (§168) so caches and the audit trail can name the version.
--   tenant_messaging_numbers — the tenant phone-number registry (§59): the provider's number SID (PN…), the purpose the
--     salon uses it for, and a lifecycle status (a released number stays as history, never re-assigned silently).
--
-- EXPAND-ONLY and idempotent; every new column is nullable or has a constant default (no table rewrite). Small tables.
ALTER TABLE tenant_messaging_credentials
  ADD COLUMN IF NOT EXISTS account_mode          TEXT NOT NULL DEFAULT 'tenant_owned',
  ADD COLUMN IF NOT EXISTS messaging_service_sid TEXT,
  ADD COLUMN IF NOT EXISTS config_version        INT  NOT NULL DEFAULT 1;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_tenant_messaging_credentials_account_mode') THEN
    ALTER TABLE tenant_messaging_credentials ADD CONSTRAINT ck_tenant_messaging_credentials_account_mode
      CHECK (account_mode IN ('platform_managed', 'tenant_owned')) NOT VALID;
    ALTER TABLE tenant_messaging_credentials VALIDATE CONSTRAINT ck_tenant_messaging_credentials_account_mode;
  END IF;
END $$;

ALTER TABLE tenant_messaging_numbers
  ADD COLUMN IF NOT EXISTS provider_phone_number_sid TEXT,
  ADD COLUMN IF NOT EXISTS purpose                   TEXT NOT NULL DEFAULT 'general_sms',
  ADD COLUMN IF NOT EXISTS status                    TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS released_at               TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at                TIMESTAMPTZ;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_tenant_messaging_numbers_purpose') THEN
    ALTER TABLE tenant_messaging_numbers ADD CONSTRAINT ck_tenant_messaging_numbers_purpose
      CHECK (purpose IN ('general_sms', 'booking', 'marketing', 'voice')) NOT VALID;
    ALTER TABLE tenant_messaging_numbers VALIDATE CONSTRAINT ck_tenant_messaging_numbers_purpose;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_tenant_messaging_numbers_status') THEN
    ALTER TABLE tenant_messaging_numbers ADD CONSTRAINT ck_tenant_messaging_numbers_status
      CHECK (status IN ('pending', 'active', 'suspended', 'released')) NOT VALID;
    ALTER TABLE tenant_messaging_numbers VALIDATE CONSTRAINT ck_tenant_messaging_numbers_status;
  END IF;
END $$;
