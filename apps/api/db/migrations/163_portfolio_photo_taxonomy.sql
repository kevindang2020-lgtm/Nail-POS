-- 163_portfolio_photo_taxonomy.sql — structured, filterable nail taxonomy on technician portfolio photos (epic Req §4–6,10).
-- Promotes the free-form `tags` JSON to typed, customer-filterable dimensions. All nullable; existing rows unaffected; no seed.
ALTER TABLE tech_portfolio_photos ADD COLUMN IF NOT EXISTS nail_shape   TEXT;  -- Round/Square/Squoval/Oval/Almond/Coffin/Ballerina/Stiletto/Lipstick/Flare/Custom
ALTER TABLE tech_portfolio_photos ADD COLUMN IF NOT EXISTS nail_length  TEXT;  -- Extra Short/Short/Medium/Long/Extra Long
ALTER TABLE tech_portfolio_photos ADD COLUMN IF NOT EXISTS design_style TEXT;  -- free short text, e.g. "Chrome ombré", "French", "Cat eye"
ALTER TABLE tech_portfolio_photos ADD COLUMN IF NOT EXISTS complexity   TEXT;  -- Simple/Moderate/Detailed/Intricate
ALTER TABLE tech_portfolio_photos ADD COLUMN IF NOT EXISTS brand        TEXT;  -- product brand/collection, e.g. "Apres Gel-X"
ALTER TABLE tech_portfolio_photos ADD COLUMN IF NOT EXISTS color_name   TEXT;  -- color name/family, e.g. "Nude", "Chrome silver"
