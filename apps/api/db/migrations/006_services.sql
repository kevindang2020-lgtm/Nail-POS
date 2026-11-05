-- 006_services.sql — AIPowerSalon POS Services (§24). Tenant-scoped. Idempotent (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS service_categories (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL,
  branch_id    UUID NOT NULL,
  name         TEXT NOT NULL,
  description  TEXT,
  color_key    TEXT,
  icon_key     TEXT,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'active',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS services (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                     UUID NOT NULL,
  branch_id                     UUID NOT NULL,
  category_id                   UUID NOT NULL,
  name                          TEXT NOT NULL,
  description                   TEXT,
  duration_minutes              INTEGER NOT NULL,
  price_cents                   INTEGER NOT NULL,
  commission_type               TEXT NOT NULL DEFAULT 'none',
  commission_value              NUMERIC(10,2) NOT NULL DEFAULT 0,
  online_booking_enabled        BOOLEAN NOT NULL DEFAULT true,
  customer_app_booking_enabled  BOOLEAN NOT NULL DEFAULT true,
  ai_booking_enabled            BOOLEAN NOT NULL DEFAULT true,
  color_key                     TEXT,
  icon_key                      TEXT,
  status                        TEXT NOT NULL DEFAULT 'active',
  sort_order                    INTEGER NOT NULL DEFAULT 0,
  created_by_user_id            UUID,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at                   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS technician_services (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  branch_id     UUID NOT NULL,
  technician_id UUID NOT NULL,
  service_id    UUID NOT NULL,
  is_primary    BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_services_tenant_branch_status
  ON services (tenant_id, branch_id, status);
CREATE INDEX IF NOT EXISTS idx_services_tenant_branch_category
  ON services (tenant_id, branch_id, category_id);
CREATE INDEX IF NOT EXISTS idx_services_tenant_branch_name
  ON services (tenant_id, branch_id, name);
CREATE INDEX IF NOT EXISTS idx_service_categories_tenant_branch_status
  ON service_categories (tenant_id, branch_id, status);
CREATE INDEX IF NOT EXISTS idx_technician_services_tenant_branch_service
  ON technician_services (tenant_id, branch_id, service_id);
CREATE INDEX IF NOT EXISTS idx_technician_services_tenant_branch_technician
  ON technician_services (tenant_id, branch_id, technician_id);
CREATE INDEX IF NOT EXISTS idx_ticket_lines_tenant_branch_service
  ON ticket_service_lines (tenant_id, branch_id, service_id, created_at);
-- [moved to 029_deferred_indexes.sql] index on 'appointment_service_lines' (table is created later)
