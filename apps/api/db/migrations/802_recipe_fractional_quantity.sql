-- 802_recipe_fractional_quantity.sql — audit D9 (Nov 4 2026): "recipe quantity floored to whole bottles; consumption empties
-- whole bottles". A recipe line is now an exact amount of the product's unit with up to two decimals (0.10 bottle of gel, 1
-- pair of gloves). Service Done takes that amount from the bottles the way a technician's recorded use does (the open
-- bottle first, its remaining % lowered; a sealed bottle opened only when needed), never a whole bottle per service.
-- Existing whole-number lines keep their value.
ALTER TABLE service_product_recipes ALTER COLUMN quantity TYPE NUMERIC(10,2) USING quantity::numeric;
ALTER TABLE service_product_recipes DROP CONSTRAINT IF EXISTS ck_service_product_recipes_quantity_positive;
ALTER TABLE service_product_recipes ADD CONSTRAINT ck_service_product_recipes_quantity_positive CHECK (quantity > 0) NOT VALID;
ALTER TABLE service_product_recipes VALIDATE CONSTRAINT ck_service_product_recipes_quantity_positive;
