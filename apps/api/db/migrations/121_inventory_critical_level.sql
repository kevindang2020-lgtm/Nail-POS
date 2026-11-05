-- 121_inventory_critical_level.sql — Multi-level stock thresholds (§16).
-- Products already have reorder_level (low) and maximum_stock (overstock); 'critical' was derived as half the
-- reorder level. This adds an independently-configurable critical_level so each tier can be set explicitly.
-- When NULL, the system falls back to the derived half-of-reorder behaviour (backward compatible). Additive only.

ALTER TABLE inventory_products ADD COLUMN IF NOT EXISTS critical_level INT;
