-- 097_gateway_paused_status.sql — add a distinct 'paused' (On Hold) status to the per-tenant gateway so the Super Admin
-- pause/resume/disable actions are genuinely different states: pause → 'paused' (reversible hold), disable → 'disabled'
-- (intentionally off), resume → 'active'. A paused/disabled gateway is non-active, so checkout already treats it as not
-- usable (the resolver derives usability from credentials + active status). Idempotent re-statement of the CHECK.
ALTER TABLE tenant_payment_config DROP CONSTRAINT IF EXISTS tenant_payment_config_status_check;
ALTER TABLE tenant_payment_config DROP CONSTRAINT IF EXISTS tenant_payment_config_status_allowed;
ALTER TABLE tenant_payment_config ADD CONSTRAINT tenant_payment_config_status_allowed
  CHECK (status IN ('pending', 'active', 'error', 'disabled', 'paused'));
