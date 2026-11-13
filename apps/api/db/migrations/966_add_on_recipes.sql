-- 966_add_on_recipes.sql — extras ADD-ONS MANAGEMENT 06 (round 11, Nov 13 2026): add-ons MAY consume inventory.
-- Kevin decides whether they do. This is the MECHANISM only, OFF by default:
--   • service_add_on_recipes — an optional recipe per add-on (the add-on's key, as on the Add-Ons screen): products and a
--     whole-number quantity, the same shape as a service recipe (service_product_recipes, migration 120).
--   • the salon's switch lives in tenant_settings (category 'inventory', settings_json.addon_recipes_enabled), absent =
--     false. While it is off nothing is deducted for add-ons — exactly today's behaviour; a saved recipe waits.
-- When the switch is on, Service Done deducts an add-on line's recipe through the SAME deduction a service recipe uses
-- (InventoryService.consumeRecipeForTicketLine → the shared bottle allocation), once per ticket line (its own
-- service_usage movement related to 'ticket_line_add_on'), and a removed line / voided ticket gives exactly those
-- amounts back (a 'correction' movement related to 'ticket_line_add_on_return', once per line).
-- PG16, no pgcrypto. Rollback: DROP TABLE service_add_on_recipes;
CREATE TABLE IF NOT EXISTS service_add_on_recipes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  add_on_key  TEXT NOT NULL CHECK (add_on_key ~ '^[A-Za-z0-9_-]{1,64}$'),
  product_id  UUID NOT NULL REFERENCES inventory_products(id),
  quantity    INTEGER NOT NULL CHECK (quantity > 0 AND quantity <= 1000),   -- whole units per add-on performed
  created_by_user_id UUID,
  updated_by  UUID,                                                         -- the person who last saved it (actor stamp)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_add_on_recipe_product UNIQUE (tenant_id, add_on_key, product_id)
);
CREATE INDEX IF NOT EXISTS idx_add_on_recipes_key ON service_add_on_recipes (tenant_id, add_on_key);
CREATE INDEX IF NOT EXISTS idx_add_on_recipes_product ON service_add_on_recipes (tenant_id, product_id);

-- B-12: a recipe line can never point at another salon's product
DROP TRIGGER IF EXISTS trg_tc_service_add_on_recipes__product_id ON service_add_on_recipes;
CREATE TRIGGER trg_tc_service_add_on_recipes__product_id BEFORE INSERT OR UPDATE OF tenant_id, product_id ON service_add_on_recipes
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('inventory_products', 'product_id');
