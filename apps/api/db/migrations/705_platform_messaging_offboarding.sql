-- 705_platform_messaging_offboarding.sql — Architecture §149, Kevin's decision (Oct 28 2026): when a salon on PLATFORM-
-- MANAGED texting (migration 668) is cancelled, its Twilio number is released and its Twilio subaccount closed, so the
-- platform stops paying for them. PlatformMessagingProvisioner.offboard does it — automatically for a salon CLOSED for
-- longer than the grace period (MESSAGING_OFFBOARD_GRACE_DAYS, default 30: a salon that comes back inside it keeps its
-- number), or at once from Super Admin (step-up + reason). A salon that brought its OWN Twilio account is never touched.
--   provisioning_step 'offboarded'   the number(s) released and the subaccount closed (terminal for this row)
--   offboarded_at / offboarding_error   when it finished / why the last attempt stopped (the next sweep resumes)
-- Additive; the step CHECK is widened (dropped and re-added with the extra value).
ALTER TABLE tenant_messaging_credentials
  ADD COLUMN IF NOT EXISTS offboarded_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS offboarding_error TEXT;

ALTER TABLE tenant_messaging_credentials DROP CONSTRAINT IF EXISTS ck_tmc_provisioning_step;
ALTER TABLE tenant_messaging_credentials ADD CONSTRAINT ck_tmc_provisioning_step
  CHECK (provisioning_step IS NULL OR provisioning_step IN ('subaccount', 'messaging_service', 'number', 'done', 'offboarded')) NOT VALID;
ALTER TABLE tenant_messaging_credentials VALIDATE CONSTRAINT ck_tmc_provisioning_step;
