-- 003_technicians.sql — AIPowerSalon POS Technicians (§24). Tenant-scoped.

CREATE TABLE IF NOT EXISTS technicians (
  id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                       UUID NOT NULL,
  branch_id                       UUID NOT NULL,
  user_id                         UUID,
  first_name                      TEXT NOT NULL,
  last_name                       TEXT NOT NULL,
  full_name                       TEXT NOT NULL,
  normalized_phone                TEXT,
  phone_display                   TEXT,
  email                           TEXT,
  avatar_url                      TEXT,
  role_label                      TEXT NOT NULL DEFAULT 'Nail Technician',
  status                          TEXT NOT NULL DEFAULT 'off_shift',
  commission_type                 TEXT NOT NULL DEFAULT 'percent',
  commission_value                INTEGER NOT NULL DEFAULT 0,
  default_commission_split_percent INTEGER NOT NULL DEFAULT 0,
  pin_hash                        TEXT,
  is_active                       BOOLEAN NOT NULL DEFAULT true,
  created_by_user_id              UUID,
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at                     TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS technician_schedules (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  branch_id         UUID NOT NULL,
  technician_id     UUID NOT NULL,
  day_of_week       SMALLINT NOT NULL,
  start_time        TIME NOT NULL,
  end_time          TIME NOT NULL,
  lunch_start_time  TIME,
  lunch_end_time    TIME,
  is_working        BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
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

CREATE TABLE IF NOT EXISTS technician_status_events (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL,
  branch_id          UUID NOT NULL,
  technician_id      UUID NOT NULL,
  old_status         TEXT,
  new_status         TEXT NOT NULL,
  reason             TEXT,
  changed_by_user_id UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_technicians_tenant_branch_status
  ON technicians (tenant_id, branch_id, status);
CREATE INDEX IF NOT EXISTS idx_technicians_tenant_branch_phone
  ON technicians (tenant_id, branch_id, normalized_phone);
CREATE INDEX IF NOT EXISTS idx_technician_services_tenant_branch_tech
  ON technician_services (tenant_id, branch_id, technician_id);
CREATE INDEX IF NOT EXISTS idx_technician_services_tenant_branch_service
  ON technician_services (tenant_id, branch_id, service_id);
CREATE INDEX IF NOT EXISTS idx_ticket_lines_tenant_branch_technician
  ON ticket_service_lines (tenant_id, branch_id, technician_id, created_at);
-- [moved] orphaned index on non-existent 'queue_items' removed; canonical table is indexed by its own migration.
-- [moved to 029_deferred_indexes.sql] index on 'appointments' (table is created later)
