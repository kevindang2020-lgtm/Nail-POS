-- 186_service_template_deployment_tracking.sql — richer deployment tracking: the tenant service created by a copy,
-- who deployed it, and the deploy result. Enables Compare Tenant Service Configurations + honest customization detection.
ALTER TABLE service_template_deployments
  ADD COLUMN IF NOT EXISTS copied_service_id uuid REFERENCES services (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deployed_by       uuid,
  ADD COLUMN IF NOT EXISTS deploy_status     text NOT NULL DEFAULT 'success';
