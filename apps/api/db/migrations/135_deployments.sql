-- 135_deployments.sql — app/firmware deployment + update-rollout tracking for Devices & Integrations (spec §33-34).
-- One row per deployable component (an app on a device group, or terminal firmware). installed_version may be NULL
-- when a provider hasn't reported it yet (honest unknown). Status is an explicit lifecycle; an update is only ever
-- shown as completed by an explicit transition, never inferred. branch_id NULL = tenant-wide rollout.
CREATE TABLE IF NOT EXISTS tenant_deployments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL,
  branch_id           UUID,                                -- NULL = tenant-wide
  component           TEXT NOT NULL,                       -- e.g. 'iPad App (Front Desk)', 'Payment Firmware'
  component_kind      TEXT NOT NULL DEFAULT 'app',         -- 'app' | 'firmware'
  installed_version   TEXT,                                -- NULL = provider hasn't reported
  latest_version      TEXT,
  target_count        INTEGER NOT NULL DEFAULT 0,
  status              TEXT NOT NULL DEFAULT 'available',   -- available|scheduled|in_progress|completed|failed|rolled_back|up_to_date|deferred|blocked
  scheduled_at        TIMESTAMPTZ,
  created_by_user_id  UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tenant_deployments_tenant ON tenant_deployments (tenant_id);
