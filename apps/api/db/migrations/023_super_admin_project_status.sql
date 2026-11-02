-- 023_super_admin_project_status.sql
-- Super Admin project-status tracking for POS Settings modules.
-- Completion is COMPUTED by the service from real capability flags; this table only persists the
-- last recheck timestamp + last computed snapshot per module (so Super Admin sees when it was checked).
-- Read/write is Super-Admin-only (enforced in the app via SuperAdminGuard); rows are global, not tenant-scoped.

CREATE TABLE IF NOT EXISTS super_admin_project_status (
  module_key          TEXT PRIMARY KEY,
  label               TEXT NOT NULL,
  route               TEXT NOT NULL,
  completion_percent  INTEGER NOT NULL DEFAULT 0,
  status              TEXT NOT NULL DEFAULT 'Not Started',
  missing_reasons     JSONB NOT NULL DEFAULT '[]'::jsonb,
  frontend_route_exists      BOOLEAN NOT NULL DEFAULT false,
  frontend_component_exists  BOOLEAN NOT NULL DEFAULT false,
  backend_endpoint_exists    BOOLEAN NOT NULL DEFAULT false,
  api_client_connected       BOOLEAN NOT NULL DEFAULT false,
  clicks_working             BOOLEAN NOT NULL DEFAULT false,
  tests_passing              BOOLEAN NOT NULL DEFAULT false,
  parent_module_key   TEXT,
  last_checked_at     TIMESTAMPTZ,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_status_parent
  ON super_admin_project_status (parent_module_key);

CREATE INDEX IF NOT EXISTS idx_project_status_status
  ON super_admin_project_status (status);
