-- 119_inventory_counts.sql — Physical Inventory Counts (§20) for the canonical Inventory system.
-- A count session snapshots the system's expected on-hand per product (at a branch, optionally scoped to a
-- category or brand), the manager enters counted quantities, variance is shown, and on reconcile the system is
-- corrected to match the count via adjustment_increase / adjustment_decrease movements (add units for overs,
-- mark units 'missing' for shorts). History is immutable. Additive only.

CREATE TABLE IF NOT EXISTS inventory_counts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  branch_id UUID NOT NULL,
  count_number TEXT,
  status TEXT NOT NULL DEFAULT 'in_progress',   -- in_progress | submitted | reconciled | cancelled
  scope_type TEXT NOT NULL DEFAULT 'all',       -- all | category | brand
  scope_id UUID,                                -- category_id or brand_id when scoped
  notes TEXT,
  line_count INT NOT NULL DEFAULT 0,            -- products in the count
  counted_count INT NOT NULL DEFAULT 0,         -- lines with a counted quantity entered
  variance_units INT NOT NULL DEFAULT 0,        -- total absolute units adjusted at reconcile
  started_by_user_id UUID,
  reconciled_by_user_id UUID,
  reconciled_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_count_scope ON inventory_counts (tenant_id, branch_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS inventory_count_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  count_id UUID NOT NULL,
  product_id UUID NOT NULL,
  expected_qty INT NOT NULL DEFAULT 0,          -- system on-hand snapshot at count start
  counted_qty INT,                              -- null until the manager enters it
  is_counted BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_count_product UNIQUE (count_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_count_lines ON inventory_count_lines (count_id);
CREATE INDEX IF NOT EXISTS idx_count_lines_scope ON inventory_count_lines (tenant_id, product_id);
