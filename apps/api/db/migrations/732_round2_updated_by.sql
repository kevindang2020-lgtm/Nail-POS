-- 732_round2_updated_by.sql — gap sweep (Oct 30 2026, check:actor-stamp; Constitution 1 §34 / §37: a change records WHO).
-- EXPAND-ONLY and idempotent. Thirteen tenant tables added by the round-2 guides (Team Management, Customer Retention,
-- AI billing / branch settings) track updated_at but never recorded who made the change. Each gets a nullable
-- `updated_by uuid` (the same shape as 661's mobile_pay_devices.updated_by: no FK, so a removed user never blocks history).
-- The writers are raw SQL (the actor-stamp plugin only stamps query-builder statements), so each person-driven UPDATE
-- sets it explicitly from the session's user; system jobs (workers, nightly runs, snapshot runs, provider sync) leave it
-- NULL — no person made that change. Existing rows stay NULL (unknown actor); nothing is backfilled or dropped.
ALTER TABLE ai_billing_invoice_links          ADD COLUMN IF NOT EXISTS updated_by uuid;
ALTER TABLE commission_discrepancy_reviews    ADD COLUMN IF NOT EXISTS updated_by uuid;
ALTER TABLE customer_retention_snapshot_runs  ADD COLUMN IF NOT EXISTS updated_by uuid;
ALTER TABLE retention_sms_campaigns           ADD COLUMN IF NOT EXISTS updated_by uuid;
ALTER TABLE retention_sms_recipients          ADD COLUMN IF NOT EXISTS updated_by uuid;
ALTER TABLE team_data_alerts                  ADD COLUMN IF NOT EXISTS updated_by uuid;
ALTER TABLE team_data_nightly_runs            ADD COLUMN IF NOT EXISTS updated_by uuid;
ALTER TABLE team_staff_certifications         ADD COLUMN IF NOT EXISTS updated_by uuid;
ALTER TABLE team_staff_profiles               ADD COLUMN IF NOT EXISTS updated_by uuid;
ALTER TABLE team_training_assignments         ADD COLUMN IF NOT EXISTS updated_by uuid;
ALTER TABLE team_training_courses             ADD COLUMN IF NOT EXISTS updated_by uuid;
ALTER TABLE tenant_ai_branch_settings         ADD COLUMN IF NOT EXISTS updated_by uuid;
ALTER TABLE tenant_retention_settings         ADD COLUMN IF NOT EXISTS updated_by uuid;
