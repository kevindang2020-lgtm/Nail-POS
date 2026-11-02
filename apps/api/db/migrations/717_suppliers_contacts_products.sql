-- 717_suppliers_contacts_products.sql — Suppliers & Purchasing mandate (Oct 29 2026). EXPAND-ONLY, idempotent: nothing
-- existing is rewritten, renamed or dropped; every vendor, purchase order, amount and audit row stays exactly as it was.
--
-- 1. inventory_vendors grows the profile the supplier form asks for (trade name, supplier code, address, notes,
--    purchasing terms, a preferred flag). The legacy contact_name / phone / email stay on the vendor row (shown as the
--    supplier's own business contact) — no backfill invents a contact person.
-- 2. inventory_vendor_contacts — one supplier, many contact people (a salesperson is a contact, never a second supplier).
--    Deactivated, never deleted, so a purchase order's history keeps who it went through.
-- 3. inventory_vendor_products — which supplier sells which product (supplier SKU, last quoted cost, purchase unit, pack
--    size, minimum order, lead time, preferred). Catalog data only: it is NOT the stock ledger and holds no quantities.
ALTER TABLE inventory_vendors ADD COLUMN IF NOT EXISTS trade_name text;
ALTER TABLE inventory_vendors ADD COLUMN IF NOT EXISTS supplier_code text;
ALTER TABLE inventory_vendors ADD COLUMN IF NOT EXISTS street text;
ALTER TABLE inventory_vendors ADD COLUMN IF NOT EXISTS city text;
ALTER TABLE inventory_vendors ADD COLUMN IF NOT EXISTS state text;
ALTER TABLE inventory_vendors ADD COLUMN IF NOT EXISTS postal_code text;
ALTER TABLE inventory_vendors ADD COLUMN IF NOT EXISTS country text;
ALTER TABLE inventory_vendors ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE inventory_vendors ADD COLUMN IF NOT EXISTS is_preferred boolean NOT NULL DEFAULT false;
ALTER TABLE inventory_vendors ADD COLUMN IF NOT EXISTS minimum_order_cents integer;
ALTER TABLE inventory_vendors ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'USD';
ALTER TABLE inventory_vendors ADD COLUMN IF NOT EXISTS deactivated_at timestamptz;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_inventory_vendors_min_order_nonneg') THEN
    ALTER TABLE inventory_vendors ADD CONSTRAINT chk_inventory_vendors_min_order_nonneg CHECK (minimum_order_cents IS NULL OR minimum_order_cents >= 0) NOT VALID;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_inventory_vendors_scope_created ON inventory_vendors (tenant_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_vendors_name ON inventory_vendors (tenant_id, lower(name));
-- a supplier code is unique per salon when set (the exact-code search ranks it first)
CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_vendors_code ON inventory_vendors (tenant_id, lower(supplier_code)) WHERE supplier_code IS NOT NULL AND supplier_code <> '';

CREATE TABLE IF NOT EXISTS inventory_vendor_contacts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL,
  vendor_id          uuid NOT NULL REFERENCES inventory_vendors (id),
  name               text NOT NULL,
  role               text,
  mobile_phone       text,
  office_phone       text,
  email              text,
  preferred_method   text CHECK (preferred_method IS NULL OR preferred_method IN ('phone', 'mobile', 'email', 'text')),
  is_primary         boolean NOT NULL DEFAULT false,
  active             boolean NOT NULL DEFAULT true,
  notes              text,
  created_by_user_id uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         uuid
);
CREATE INDEX IF NOT EXISTS idx_inv_vendor_contacts_vendor ON inventory_vendor_contacts (tenant_id, vendor_id, is_primary DESC, created_at DESC);
-- phone search is on digits only, so "(856) 555-1234", "856-555-1234" and "+1 856 555 1234" all match
CREATE INDEX IF NOT EXISTS idx_inv_vendor_contacts_phone ON inventory_vendor_contacts (tenant_id, regexp_replace(coalesce(mobile_phone, '') || ' ' || coalesce(office_phone, ''), '\D', '', 'g'));
CREATE INDEX IF NOT EXISTS idx_inv_vendor_contacts_email ON inventory_vendor_contacts (tenant_id, lower(email));
-- at most one ACTIVE primary contact per supplier
CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_vendor_contacts_primary ON inventory_vendor_contacts (tenant_id, vendor_id) WHERE is_primary AND active;

CREATE TABLE IF NOT EXISTS inventory_vendor_products (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL,
  vendor_id            uuid NOT NULL REFERENCES inventory_vendors (id),
  product_id           uuid NOT NULL REFERENCES inventory_products (id),
  supplier_sku         text,
  last_cost_cents      integer CHECK (last_cost_cents IS NULL OR last_cost_cents >= 0),
  purchase_unit        text,                       -- case / box / pack / bottle …
  units_per_purchase_unit integer NOT NULL DEFAULT 1 CHECK (units_per_purchase_unit >= 1),   -- bottles in one purchase unit
  minimum_order_qty    integer CHECK (minimum_order_qty IS NULL OR minimum_order_qty >= 1),
  lead_time_days       integer CHECK (lead_time_days IS NULL OR lead_time_days >= 0),
  is_preferred         boolean NOT NULL DEFAULT false,
  currency             text NOT NULL DEFAULT 'USD',
  active               boolean NOT NULL DEFAULT true,
  created_by_user_id   uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           uuid
);
-- one link per supplier × product (re-adding a removed link re-activates it)
CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_vendor_products ON inventory_vendor_products (tenant_id, vendor_id, product_id);
CREATE INDEX IF NOT EXISTS idx_inv_vendor_products_product ON inventory_vendor_products (tenant_id, product_id) WHERE active;
CREATE INDEX IF NOT EXISTS idx_inv_vendor_products_sku ON inventory_vendor_products (tenant_id, lower(supplier_sku)) WHERE supplier_sku IS NOT NULL;

-- purchase-order lists: newest first per salon / branch across every status (idx_po_scope leads with status; the supplier
-- lookup already has idx_po_vendor)
CREATE INDEX IF NOT EXISTS idx_purchase_orders_scope_created ON purchase_orders (tenant_id, branch_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_number ON purchase_orders (tenant_id, lower(po_number));
-- product lists: newest first
CREATE INDEX IF NOT EXISTS idx_inventory_products_scope_created ON inventory_products (tenant_id, created_at DESC, id DESC);
