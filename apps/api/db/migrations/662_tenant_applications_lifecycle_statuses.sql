-- 662_tenant_applications_lifecycle_statuses.sql — the application intake lifecycle's statuses are storable (wave 4 PILOT).
--
-- Migration 060 limited tenant_applications.status to the eight original values. The intake lifecycle (Jul 2026,
-- applications-lifecycle-core.ts APPLICATION_STATUSES) moves an application through under_review, contact_attempted,
-- contacted, info_requested, awaiting_applicant, rejected, converted_onboarding, converted_tenant, duplicate, spam and
-- withdrawn too — every one of those writes failed on the old CHECK (the Super Admin's status buttons answered 404 and
-- "Start Onboarding" left the application approved and unlinked). Forward-only: the new set is a superset, so every
-- existing row already satisfies it.
ALTER TABLE tenant_applications DROP CONSTRAINT IF EXISTS tenant_applications_status_check;
ALTER TABLE tenant_applications ADD CONSTRAINT tenant_applications_status_check CHECK (status IN (
  'new',
  'under_review', 'reviewing',
  'contact_attempted', 'contacted', 'info_requested', 'awaiting_applicant', 'demo_scheduled',
  'qualified', 'not_qualified',
  'approved', 'rejected',
  'converted_onboarding', 'converted_tenant', 'converted',
  'duplicate', 'spam', 'withdrawn',
  'archived'
));
