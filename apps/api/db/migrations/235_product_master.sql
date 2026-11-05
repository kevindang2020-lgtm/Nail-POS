-- 175_product_master.sql
-- Platform-level MASTER product catalog for Super Admin › Catalog Management › Product Catalog.
-- A master product is a reusable, standardized platform definition. It is NOT a tenant-owned product and NOT branch
-- inventory: distributing a master product to a tenant creates/links a tenant-owned inventory_products record via the
-- existing architecture; branch stock stays in the tenant POS. Money is integer cents (BIGINT). Duplicate detection
-- keys off normalized_sku / barcode / normalized_name. 'retired'/'discontinued' preserve the record (no hard delete).
CREATE TABLE IF NOT EXISTS product_master (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                      TEXT,
  name                      TEXT NOT NULL,
  normalized_name           TEXT NOT NULL,
  brand_name                TEXT,
  sku                       TEXT,
  normalized_sku            TEXT,
  manufacturer_sku          TEXT,
  upc                       TEXT,
  barcode                   TEXT,
  category_name             TEXT,
  product_type              TEXT,
  description               TEXT,
  cost_cents                BIGINT,
  suggested_retail_cents    BIGINT,
  currency                  TEXT NOT NULL DEFAULT 'USD',
  tax_category              TEXT,
  inventory_unit            TEXT NOT NULL DEFAULT 'each',
  vendor_name               TEXT,
  is_retail                 BOOLEAN NOT NULL DEFAULT true,
  is_service                BOOLEAN NOT NULL DEFAULT false,
  optional_product          BOOLEAN NOT NULL DEFAULT true,
  tenant_may_customize_price    BOOLEAN NOT NULL DEFAULT true,
  tenant_may_customize_cost     BOOLEAN NOT NULL DEFAULT true,
  tenant_may_customize_vendor   BOOLEAN NOT NULL DEFAULT true,
  tenant_may_customize_tax      BOOLEAN NOT NULL DEFAULT true,
  tenant_may_customize_category BOOLEAN NOT NULL DEFAULT true,
  tenant_may_deactivate         BOOLEAN NOT NULL DEFAULT true,
  status                    TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','active','inactive','retired','discontinued','pending_review','archived','rejected')),
  internal_notes            TEXT,
  version_note              TEXT,
  created_by_user_id        UUID,
  retired_by_user_id        UUID,
  retired_reason            TEXT,
  retired_at                TIMESTAMPTZ,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (cost_cents IS NULL OR cost_cents >= 0),
  CHECK (suggested_retail_cents IS NULL OR suggested_retail_cents >= 0)
);

-- A product code, when present, is unique across the master catalog (duplicate code is blocked).
CREATE UNIQUE INDEX IF NOT EXISTS ux_product_master_code ON product_master (code) WHERE code IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_product_master_norm_sku  ON product_master (normalized_sku) WHERE normalized_sku IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_product_master_barcode   ON product_master (barcode)        WHERE barcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_product_master_norm_name ON product_master (normalized_name);
CREATE INDEX IF NOT EXISTS ix_product_master_status    ON product_master (status);
CREATE INDEX IF NOT EXISTS ix_product_master_category  ON product_master (category_name);
CREATE INDEX IF NOT EXISTS ix_product_master_brand     ON product_master (brand_name);
CREATE INDEX IF NOT EXISTS ix_product_master_created   ON product_master (created_at DESC);
