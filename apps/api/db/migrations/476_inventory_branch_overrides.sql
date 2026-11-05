-- 436_inventory_branch_overrides.sql — Branch-level configuration for Low Stock Alerts (§17).
-- Allows overriding reorder points, quantities, vendor, and lead time per location, falling
-- back to tenant defaults (inventory_products) when the override is NULL. Additive only.

ALTER TABLE inventory_products ADD COLUMN IF NOT EXISTS lead_time_days INT;

ALTER TABLE inventory_location_stock ADD COLUMN IF NOT EXISTS reorder_level_override INT;
ALTER TABLE inventory_location_stock ADD COLUMN IF NOT EXISTS reorder_quantity_override INT;
ALTER TABLE inventory_location_stock ADD COLUMN IF NOT EXISTS preferred_vendor_id_override UUID;
ALTER TABLE inventory_location_stock ADD COLUMN IF NOT EXISTS lead_time_days_override INT;
ALTER TABLE inventory_location_stock ADD COLUMN IF NOT EXISTS critical_level_override INT;
