-- 177_product_distribution.sql
-- Optional distribution of a MASTER product to tenants. Each distribution creates or links a tenant-owned product
-- record (inventory_products) via the existing architecture — it NEVER creates branch inventory quantities, purchase
-- orders, or stock adjustments, and NEVER overwrites tenant customizations. Idempotent: at most one distribution per
-- (master_product_id, tenant_id).
CREATE TABLE IF NOT EXISTS product_distributions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  master_product_id  UUID NOT NULL REFERENCES product_master(id) ON DELETE CASCADE,
  tenant_id          UUID NOT NULL,
  status             TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','distributed','skipped_existing','failed')),
  tenant_product_id  UUID,                 -- the tenant-owned inventory_products row created or linked
  master_version_note TEXT,
  reason             TEXT,
  detail             TEXT,
  created_by_user_id UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at       TIMESTAMPTZ
);

-- Idempotency: a master product is distributed to a given tenant at most once. Re-running the same push is a no-op.
CREATE UNIQUE INDEX IF NOT EXISTS ux_product_distribution_master_tenant ON product_distributions (master_product_id, tenant_id);
CREATE INDEX IF NOT EXISTS ix_product_distribution_master ON product_distributions (master_product_id);
CREATE INDEX IF NOT EXISTS ix_product_distribution_tenant ON product_distributions (tenant_id);
CREATE INDEX IF NOT EXISTS ix_product_distribution_status ON product_distributions (status);
