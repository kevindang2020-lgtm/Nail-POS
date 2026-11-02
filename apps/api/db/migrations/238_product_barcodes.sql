-- 178_product_barcodes.sql
-- Barcode management for master products: add / correct / validate, with full history (rows are retired, never
-- deleted) and an actor + reason on every change. An active, valid barcode value belongs to at most one product —
-- the partial unique index prevents silently reassigning a barcode already attached to another active product.
CREATE TABLE IF NOT EXISTS product_barcodes (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  master_product_id  UUID NOT NULL REFERENCES product_master(id) ON DELETE CASCADE,
  barcode            TEXT NOT NULL,
  barcode_type       TEXT NOT NULL DEFAULT 'unknown',   -- upc_a | ean_13 | other | unknown
  is_primary         BOOLEAN NOT NULL DEFAULT false,
  valid              BOOLEAN NOT NULL DEFAULT true,
  source             TEXT,                               -- manual | import | vendor_feed | correction
  reason             TEXT,
  created_by_user_id UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  retired_at         TIMESTAMPTZ
);

-- A given barcode value is active on at most one product at a time.
CREATE UNIQUE INDEX IF NOT EXISTS ux_product_barcode_active ON product_barcodes (barcode) WHERE retired_at IS NULL AND valid = true;
-- At most one active primary barcode per product.
CREATE UNIQUE INDEX IF NOT EXISTS ux_product_barcode_primary ON product_barcodes (master_product_id) WHERE is_primary = true AND retired_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_product_barcodes_master ON product_barcodes (master_product_id);
CREATE INDEX IF NOT EXISTS ix_product_barcodes_value  ON product_barcodes (barcode);
