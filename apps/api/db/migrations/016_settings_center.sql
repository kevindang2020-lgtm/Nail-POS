-- 016_settings_center.sql — AIPowerSalon POS Settings Center. Idempotent.
-- Consolidated per-category settings store. Category-specific tables built earlier
-- (store_hours/auto-logout in 010, checkout_settings/customer_display_* in 015) are reused;
-- everything else lives in tenant_settings keyed by category, so "create safe defaults once,
-- save, return" is a single code path. branch_id NULL = tenant-wide.

CREATE TABLE IF NOT EXISTS tenant_settings (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL,
  branch_id          UUID,                      -- NULL = tenant-wide
  category           TEXT NOT NULL,             -- e.g. 'payments-checkout', 'tips', 'booking-appointments'
  settings_json      JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by_user_id UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, branch_id, category)
);

-- tenant_role_permissions: tenant-scoped permission overrides (distinct from auth RBAC role_permissions in 001).
CREATE TABLE IF NOT EXISTS tenant_role_permissions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL,
  branch_id   UUID,
  role        TEXT NOT NULL,                    -- OWNER | MANAGER | FRONT_DESK | RECEPTION | TECHNICIAN
  permission  TEXT NOT NULL,                    -- e.g. 'checkout.take_payment', 'settings.payments_edit'
  allowed     BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, branch_id, role, permission)
);

CREATE TABLE IF NOT EXISTS settings_audit_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL,
  branch_id    UUID,
  user_id      UUID NOT NULL,
  role         TEXT NOT NULL,
  action_type  TEXT NOT NULL,                   -- e.g. 'payment_settings_updated'
  entity_type  TEXT NOT NULL DEFAULT 'settings',
  entity_id    TEXT NOT NULL,
  before_json  JSONB,
  after_json   JSONB,
  metadata     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tenant_settings_tenant_branch_cat
  ON tenant_settings (tenant_id, branch_id, category);
CREATE INDEX IF NOT EXISTS idx_tenant_role_permissions_tenant_role
  ON tenant_role_permissions (tenant_id, role);
CREATE INDEX IF NOT EXISTS idx_settings_audit_tenant_created
  ON settings_audit_logs (tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_settings_audit_tenant_action
  ON settings_audit_logs (tenant_id, action_type);
