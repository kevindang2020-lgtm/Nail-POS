-- 161_customer_safety_fields.sql — customer safety attributes for the Tech App's highlighted Safety card (spec §12/§34).
-- Allergies/sensitivities a technician must confirm before service, plus free-form safety notes (e.g. prior reaction,
-- products to avoid). Tenant-scoped via the existing customers row; nullable; no rows seeded.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS allergies   JSONB;   -- array of strings, e.g. ["Latex","Acetone"]
ALTER TABLE customers ADD COLUMN IF NOT EXISTS safety_notes TEXT;
