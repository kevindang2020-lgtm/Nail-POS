-- 120_service_recipes.sql — Service Recipes (§13): the products (and quantities) a service consumes.
-- When a service is performed, its recipe can deduct those products from inventory (service_usage movements).
-- A recipe is a per-service list of (product, quantity). Whole-unit consumption (files, cotton, foils, tips, etc.).
-- Additive only.

CREATE TABLE IF NOT EXISTS service_product_recipes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  service_id UUID NOT NULL,
  product_id UUID NOT NULL,
  quantity INT NOT NULL DEFAULT 1,        -- whole units consumed per service performed
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_service_product UNIQUE (service_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_recipe_service ON service_product_recipes (tenant_id, service_id);
CREATE INDEX IF NOT EXISTS idx_recipe_product ON service_product_recipes (tenant_id, product_id);
