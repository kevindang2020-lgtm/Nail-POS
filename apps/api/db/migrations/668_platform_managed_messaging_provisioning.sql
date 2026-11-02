-- 668_platform_managed_messaging_provisioning.sql — B-16 (Oct 20 2026): a 'platform_managed' salon (639, §185) is provisioned
-- by the platform from Super Admin: its Twilio subaccount → its Messaging Service → its number (purchased, registered,
-- attached) → configured. The steps are resumable — each one is skipped when already done — so the row records how far it
-- got and why it stopped; a claim (provisioning_claimed_at) keeps two Super Admins from provisioning the same salon at once.
--   provisioning_step       the last step COMPLETED: subaccount | messaging_service | number | done (NULL = not started)
--   provisioning_error      the last failure, in plain words (NULL after a success)
--   provisioning_claimed_at set while a run is in progress (a stale claim, > 5 minutes, may be taken over)
--   provisioned_at          when the salon's messaging went live
-- EXPAND-ONLY: nullable columns and one CHECK on a small table.
ALTER TABLE tenant_messaging_credentials
  ADD COLUMN IF NOT EXISTS provisioning_step       TEXT,
  ADD COLUMN IF NOT EXISTS provisioning_error      TEXT,
  ADD COLUMN IF NOT EXISTS provisioning_claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS provisioned_at          TIMESTAMPTZ;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_tmc_provisioning_step') THEN
    ALTER TABLE tenant_messaging_credentials ADD CONSTRAINT ck_tmc_provisioning_step
      CHECK (provisioning_step IS NULL OR provisioning_step IN ('subaccount', 'messaging_service', 'number', 'done')) NOT VALID;
    ALTER TABLE tenant_messaging_credentials VALIDATE CONSTRAINT ck_tmc_provisioning_step;
  END IF;
END $$;
