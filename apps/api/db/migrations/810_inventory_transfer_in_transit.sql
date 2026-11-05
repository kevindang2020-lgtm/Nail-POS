-- 810_inventory_transfer_in_transit.sql — D9 gaps (Nov 5 2026): a transfer can be SHIPPED (in transit) instead of moved at once.
-- Shipped bottles leave the source's stock and are not on hand anywhere until the destination receives them (status
-- 'in_transit', the bottle's earlier status kept to restore it). The destination receives all or part (the rest is recorded
-- missing at the destination); the source can cancel while it is still in transit (the bottles come back as they were).
-- The immediate transfer (status 'completed' at once) is unchanged.
ALTER TABLE inventory_transfers DROP CONSTRAINT IF EXISTS chk_inventory_transfers_status_vocab;
ALTER TABLE inventory_transfers ADD CONSTRAINT chk_inventory_transfers_status_vocab CHECK (status IN ('cancelled', 'completed', 'in_transit'));
ALTER TABLE inventory_transfers ADD COLUMN IF NOT EXISTS dispatched_at TIMESTAMPTZ;
ALTER TABLE inventory_transfers ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ;
ALTER TABLE inventory_transfers ADD COLUMN IF NOT EXISTS received_by_user_id UUID;
ALTER TABLE inventory_transfers ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE inventory_transfers ADD COLUMN IF NOT EXISTS cancelled_by_user_id UUID;
ALTER TABLE inventory_transfers ADD COLUMN IF NOT EXISTS cancel_reason TEXT;
ALTER TABLE inventory_transfer_lines ADD COLUMN IF NOT EXISTS quantity_received INTEGER;
ALTER TABLE inventory_units ADD COLUMN IF NOT EXISTS in_transfer_id UUID;
ALTER TABLE inventory_units ADD COLUMN IF NOT EXISTS transit_from_status TEXT;
CREATE INDEX IF NOT EXISTS idx_inventory_units_in_transfer ON inventory_units (tenant_id, in_transfer_id) WHERE in_transfer_id IS NOT NULL;
