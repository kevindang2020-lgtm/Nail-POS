-- 185_service_templates_lifecycle.sql — publish/retire lifecycle audit columns for service templates.
ALTER TABLE service_templates
  ADD COLUMN IF NOT EXISTS published_at  timestamptz,
  ADD COLUMN IF NOT EXISTS published_by  uuid,
  ADD COLUMN IF NOT EXISTS retired_at    timestamptz,
  ADD COLUMN IF NOT EXISTS retired_by    uuid,
  ADD COLUMN IF NOT EXISTS retire_reason text,
  ADD COLUMN IF NOT EXISTS updated_by    uuid;

-- Backfill published_at for already-published seed rows so the surface reflects their state honestly.
UPDATE service_templates SET published_at = COALESCE(published_at, updated_at) WHERE status = 'published';
