-- 117_purchase_orders.sql — Purchase Orders (§18) for the canonical Inventory Management system.
-- A PO is per-branch and references a vendor; line items are per product. Receiving feeds the existing
-- inventory_units path (addStock → 'purchase_received' movement). History is immutable; PO status is
-- derived from line received-vs-ordered, never edited in place beyond the lifecycle stamps. Additive only.

CREATE TABLE IF NOT EXISTS purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  branch_id UUID NOT NULL,
  vendor_id UUID,
  po_number TEXT,
  status TEXT NOT NULL DEFAULT 'draft',   -- draft | approved | ordered | partial | received | cancelled | closed
  expected_date DATE,
  notes TEXT,
  subtotal_cents INT NOT NULL DEFAULT 0,
  shipping_cents INT NOT NULL DEFAULT 0,
  tax_cents INT NOT NULL DEFAULT 0,
  total_cents INT NOT NULL DEFAULT 0,
  created_by_user_id UUID,
  approved_by_user_id UUID,
  approved_at TIMESTAMPTZ,
  ordered_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_po_scope ON purchase_orders (tenant_id, branch_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_po_vendor ON purchase_orders (tenant_id, vendor_id);

CREATE TABLE IF NOT EXISTS purchase_order_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  purchase_order_id UUID NOT NULL,
  product_id UUID NOT NULL,
  quantity_ordered INT NOT NULL DEFAULT 0,
  quantity_received INT NOT NULL DEFAULT 0,
  unit_cost_cents INT NOT NULL DEFAULT 0,
  lot_number TEXT,
  expiration_date DATE,
  storage_location TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- a line never receives more than was ordered (defense-in-depth against double-receive races, §25)
  CONSTRAINT chk_po_line_not_over_received CHECK (quantity_received <= quantity_ordered)
);
CREATE INDEX IF NOT EXISTS idx_po_lines_po ON purchase_order_lines (purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_po_lines_scope ON purchase_order_lines (tenant_id, product_id);
