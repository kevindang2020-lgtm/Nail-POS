-- 129_product_category_merge_logs.sql
-- Lineage/recovery log for Global Product Catalog product-category merges (§23).
-- A merge reattributes a tenant's products from a duplicate (source) inventory category onto a surviving (target)
-- category within the SAME tenant, then deactivates the source. This table records enough to audit and recover the
-- action: the full source-category snapshot and the count of products that were reattributed. It never spans tenants.
CREATE TABLE IF NOT EXISTS product_category_merge_logs (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   UUID NOT NULL,
  source_category_id          UUID NOT NULL,
  target_category_id          UUID NOT NULL,
  reattributed_product_count  INTEGER NOT NULL DEFAULT 0,
  merged_by_user_id           UUID,
  merge_summary_json          JSONB,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prod_cat_merge_logs_tenant ON product_category_merge_logs (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prod_cat_merge_logs_source ON product_category_merge_logs (source_category_id);
