-- 012_overview.sql — AIPowerSalon Overview performance indexes (§15) + optional supporting tables.
-- Idempotent. Most tables exist from earlier migrations; only add what the Overview reads need.

-- supporting tables referenced by Overview KPIs/insights (create only if your schema lacks them)
CREATE TABLE IF NOT EXISTS technician_shifts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  branch_id     UUID NOT NULL,
  technician_id UUID NOT NULL,
  shift_date    DATE NOT NULL,
  start_time    TIMESTAMPTZ,
  end_time      TIMESTAMPTZ,
  status        TEXT NOT NULL DEFAULT 'scheduled',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS technician_statuses (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  branch_id     UUID NOT NULL,
  technician_id UUID NOT NULL,
  status        TEXT NOT NULL DEFAULT 'available',
  changed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS inventory_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  branch_id     UUID NOT NULL,
  name          TEXT NOT NULL,
  quantity      INTEGER NOT NULL DEFAULT 0,
  low_threshold INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- performance indexes for the single overview query (§15)
CREATE INDEX IF NOT EXISTS idx_appointments_tenant_branch_start_status
  ON appointments (tenant_id, branch_id, start_time, status);
-- [moved] orphaned index on non-existent 'queue_items' removed; canonical table is indexed by its own migration.
CREATE INDEX IF NOT EXISTS idx_tickets_tenant_branch_status_created
  ON tickets (tenant_id, branch_id, status, created_at);
-- [moved to 029_deferred_indexes.sql] index on 'payments' (table is created later)
CREATE INDEX IF NOT EXISTS idx_technician_statuses_tenant_branch_status
  ON technician_statuses (tenant_id, branch_id, status);
CREATE INDEX IF NOT EXISTS idx_technician_shifts_tenant_branch_date
  ON technician_shifts (tenant_id, branch_id, shift_date);
CREATE INDEX IF NOT EXISTS idx_inventory_tenant_branch
  ON inventory_items (tenant_id, branch_id);
