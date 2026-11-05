ALTER TABLE tickets ADD COLUMN discount_snapshot JSONB;
ALTER TABLE inventory_products ADD COLUMN allow_negative_stock BOOLEAN DEFAULT false;
