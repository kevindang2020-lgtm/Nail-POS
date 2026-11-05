-- 118_inventory_transfers.sql — Branch/Location Transfers (§19) for the canonical Inventory system.
-- A transfer moves physical stock of one or more products from one branch to another within the SAME
-- tenant. Bottle-tracked units are reassigned (branch_id source → destination) and a paired movement
-- ledger is written (transfer_out at source, transfer_in at destination); per-branch location_stock is
-- recomputed from the authoritative unit rows. History is immutable. Additive only.

CREATE TABLE IF NOT EXISTS inventory_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  from_branch_id UUID NOT NULL,
  to_branch_id UUID NOT NULL,
  transfer_number TEXT,
  status TEXT NOT NULL DEFAULT 'completed',   -- completed | cancelled (immediate model)
  notes TEXT,
  item_count INT NOT NULL DEFAULT 0,          -- distinct products moved
  unit_count INT NOT NULL DEFAULT 0,          -- total bottles/units actually moved
  created_by_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_transfer_distinct_branches CHECK (from_branch_id <> to_branch_id)
);
CREATE INDEX IF NOT EXISTS idx_transfer_from ON inventory_transfers (tenant_id, from_branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transfer_to ON inventory_transfers (tenant_id, to_branch_id, created_at DESC);

CREATE TABLE IF NOT EXISTS inventory_transfer_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  transfer_id UUID NOT NULL,
  product_id UUID NOT NULL,
  quantity_requested INT NOT NULL DEFAULT 0,
  quantity_moved INT NOT NULL DEFAULT 0,      -- may be < requested if the source branch was short
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_transfer_line_moved CHECK (quantity_moved <= quantity_requested)
);
CREATE INDEX IF NOT EXISTS idx_transfer_lines ON inventory_transfer_lines (transfer_id);
CREATE INDEX IF NOT EXISTS idx_transfer_lines_scope ON inventory_transfer_lines (tenant_id, product_id);
