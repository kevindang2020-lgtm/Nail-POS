-- 821_vendor_normalized_name.sql — Receipt / Expense / OCR mandate (F7) §44 + §154 (Nov 6 2026). The vendor row carries
-- its comparison form and a type, so "HOME DEPOT #4102", "THE HOME DEPOT" and "Home Depot" find the same vendor through an
-- index instead of a scan over raw names.
--
-- normalized_name is maintained by a trigger (every writer — Suppliers, Expenses, OCR matching, Super Admin catalogue —
-- gets it without code changes) with the SAME rules as modules/finance/src/vendor-normalize.ts normalizeVendorName():
-- lower-case, accents removed, '&' → ' and ', apostrophes dropped, store numbers removed, punctuation → space, up to two
-- legal suffixes removed, a leading "the" removed, spaces collapsed, at most 120 characters.
-- The equivalence is tested (finance vendor-normalize.pgtest).
CREATE OR REPLACE FUNCTION vendor_normalized_name(raw text) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE s text;
BEGIN
  s := lower(coalesce(raw, ''));
  s := regexp_replace(normalize(s, NFKD), '[̀-ͯ]', '', 'g');
  s := replace(s, '&', ' and ');
  s := regexp_replace(s, '[''’`]', '', 'g');
  s := regexp_replace(s, '(\s*(#|no\.?|store|str|location|loc)\s*\d+[a-z]?\M)|(\s+\d{3,}$)', ' ', 'g');
  s := btrim(regexp_replace(s, '[^a-z0-9]+', ' ', 'g'));
  FOR i IN 1..2 LOOP
    s := btrim(regexp_replace(s, '\m(inc|incorporated|llc|l\.l\.c|ltd|limited|corp|corporation|co|company|plc|lp|llp|pc|pllc)\M\.?$', ''));
  END LOOP;
  s := btrim(regexp_replace(regexp_replace(s, '^the\s+', ''), '\s+', ' ', 'g'));
  RETURN left(s, 120);
END $$;

ALTER TABLE inventory_vendors ADD COLUMN IF NOT EXISTS normalized_name text;
ALTER TABLE inventory_vendors ADD COLUMN IF NOT EXISTS vendor_type text;
ALTER TABLE inventory_vendors DROP CONSTRAINT IF EXISTS chk_inventory_vendors_type;
ALTER TABLE inventory_vendors ADD CONSTRAINT chk_inventory_vendors_type
  CHECK (vendor_type IS NULL OR vendor_type IN ('product_supplier', 'service_provider', 'utility', 'landlord', 'retail_store', 'government', 'other'));

CREATE OR REPLACE FUNCTION trg_inventory_vendors_normalized_name() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.normalized_name := vendor_normalized_name(NEW.name);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_inventory_vendors_normalized_name ON inventory_vendors;
CREATE TRIGGER trg_inventory_vendors_normalized_name BEFORE INSERT OR UPDATE OF name ON inventory_vendors
  FOR EACH ROW EXECUTE FUNCTION trg_inventory_vendors_normalized_name();

UPDATE inventory_vendors SET normalized_name = vendor_normalized_name(name) WHERE normalized_name IS DISTINCT FROM vendor_normalized_name(name);
CREATE INDEX IF NOT EXISTS ix_inventory_vendors_tenant_normalized ON inventory_vendors (tenant_id, normalized_name);
