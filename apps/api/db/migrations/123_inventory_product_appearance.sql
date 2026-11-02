-- 123_inventory_product_appearance.sql — Product images & button colors (§7/§22).
-- Adds an image URL and a POS button color to products (barcode/upc already exist). The button color is a hex
-- value used to tint the product's button/swatch; image_url points at a product photo. Both nullable. Additive only.

ALTER TABLE inventory_products ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE inventory_products ADD COLUMN IF NOT EXISTS button_color TEXT;
