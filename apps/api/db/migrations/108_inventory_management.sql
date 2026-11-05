-- 108_inventory_management.sql — canonical tenant Inventory Management (categories, brands, vendors,
-- products, per-location stock, individual bottle/unit tracking, immutable stock-movement ledger, and
-- technician reports). Products are tenant-level definitions; STOCK and BOTTLES are per-branch (§19).
-- Additive only; the legacy trivial `inventory_items` table is left untouched.

CREATE TABLE IF NOT EXISTS inventory_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  parent_category_id UUID,
  name TEXT NOT NULL, code TEXT, description TEXT, display_color TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  tracking_mode TEXT NOT NULL DEFAULT 'quantity',   -- quantity | bottle
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inv_categories_tenant ON inventory_categories (tenant_id, active);

CREATE TABLE IF NOT EXISTS inventory_brands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  name TEXT NOT NULL, code TEXT, website TEXT, notes TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inv_brands_tenant ON inventory_brands (tenant_id, active);

CREATE TABLE IF NOT EXISTS inventory_vendors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  name TEXT NOT NULL, contact_name TEXT, phone TEXT, email TEXT, website TEXT,
  account_number TEXT, payment_terms TEXT, lead_time_days INT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inv_vendors_tenant ON inventory_vendors (tenant_id, active);

CREATE TABLE IF NOT EXISTS inventory_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  category_id UUID, brand_id UUID, preferred_vendor_id UUID,
  name TEXT NOT NULL, product_line TEXT,
  color_name TEXT, color_number TEXT, color_family TEXT, finish TEXT,
  sku TEXT, barcode TEXT, upc TEXT,
  unit_type TEXT NOT NULL DEFAULT 'bottle',
  size_value NUMERIC, size_unit TEXT,
  tracking_mode TEXT NOT NULL DEFAULT 'quantity',   -- quantity | bottle
  cost_cents INT, retail_price_cents INT,
  reorder_level INT NOT NULL DEFAULT 0, reorder_quantity INT NOT NULL DEFAULT 0, maximum_stock INT,
  track_expiration BOOLEAN NOT NULL DEFAULT false,
  is_retail BOOLEAN NOT NULL DEFAULT false, is_service BOOLEAN NOT NULL DEFAULT true,
  active BOOLEAN NOT NULL DEFAULT true, archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inv_products_tenant ON inventory_products (tenant_id, active);
CREATE INDEX IF NOT EXISTS idx_inv_products_cat ON inventory_products (tenant_id, category_id);
CREATE INDEX IF NOT EXISTS idx_inv_products_brand ON inventory_products (tenant_id, brand_id);
CREATE INDEX IF NOT EXISTS idx_inv_products_barcode ON inventory_products (tenant_id, barcode);

CREATE TABLE IF NOT EXISTS inventory_location_stock (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL, branch_id UUID NOT NULL, product_id UUID NOT NULL,
  quantity_on_hand INT NOT NULL DEFAULT 0, quantity_available INT NOT NULL DEFAULT 0,
  quantity_reserved INT NOT NULL DEFAULT 0, quantity_unopened INT NOT NULL DEFAULT 0,
  quantity_open INT NOT NULL DEFAULT 0, quantity_low INT NOT NULL DEFAULT 0,
  quantity_empty INT NOT NULL DEFAULT 0, quantity_damaged INT NOT NULL DEFAULT 0,
  average_cost_cents INT, last_counted_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (branch_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_inv_stock_scope ON inventory_location_stock (tenant_id, branch_id);

CREATE TABLE IF NOT EXISTS inventory_units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL, branch_id UUID NOT NULL, product_id UUID NOT NULL,
  internal_barcode TEXT, lot_number TEXT, expiration_date DATE,
  status TEXT NOT NULL DEFAULT 'unopened',  -- unopened|opened|low|empty|damaged|expired|missing|returned|disposed
  estimated_remaining_percent INT,
  received_at TIMESTAMPTZ DEFAULT now(), opened_at TIMESTAMPTZ, opened_by_user_id UUID,
  emptied_at TIMESTAMPTZ, emptied_by_user_id UUID,
  storage_location TEXT, notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inv_units_scope ON inventory_units (tenant_id, branch_id, product_id);
CREATE INDEX IF NOT EXISTS idx_inv_units_status ON inventory_units (tenant_id, branch_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_inv_units_barcode ON inventory_units (tenant_id, internal_barcode) WHERE internal_barcode IS NOT NULL;

-- immutable ledger — corrections are NEW reversing rows, never edits
CREATE TABLE IF NOT EXISTS inventory_stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL, branch_id UUID NOT NULL, product_id UUID NOT NULL,
  inventory_unit_id UUID,
  movement_type TEXT NOT NULL,
  quantity_before INT, quantity_change INT, quantity_after INT, unit TEXT,
  related_type TEXT, related_id UUID, actor_user_id UUID, reason TEXT,
  metadata_json JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inv_moves_scope ON inventory_stock_movements (tenant_id, branch_id, product_id, created_at DESC);

CREATE TABLE IF NOT EXISTS inventory_technician_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL, branch_id UUID NOT NULL, product_id UUID NOT NULL,
  inventory_unit_id UUID, technician_user_id UUID NOT NULL, service_ticket_id UUID,
  report_type TEXT NOT NULL,   -- bottle_empty|bottle_low|open_new|damaged|missing|expired|wrong_quantity|need_reorder|used|other
  reported_quantity INT, estimated_remaining_percent INT, photo_url TEXT, note TEXT,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending|approved|rejected|corrected|automatically_processed
  reviewed_by_user_id UUID, reviewed_at TIMESTAMPTZ, resolution_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inv_techrep_scope ON inventory_technician_reports (tenant_id, branch_id, status);
-- prevent duplicate pending reports for the same bottle + type (§33)
CREATE UNIQUE INDEX IF NOT EXISTS idx_inv_techrep_dedup ON inventory_technician_reports (inventory_unit_id, report_type)
  WHERE status = 'pending' AND inventory_unit_id IS NOT NULL;
