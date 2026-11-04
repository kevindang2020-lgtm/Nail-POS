-- 792_service_taxable.sql — D2 Services guide (Nov 4 2026): per-service tax treatment. A service can be marked NOT taxable
-- (services.is_taxable); every ticket line keeps its own copy (ticket_service_lines.is_taxable), taken from the service when
-- the line is written, so changing the setting later never changes a ticket already rung up. Retail lines and lines without
-- a service stay taxable (as before). Every existing service and line is taxable: a salon that changes nothing is charged
-- exactly as before. The tax RATE stays the salon's / location's rate.
ALTER TABLE services ADD COLUMN IF NOT EXISTS is_taxable BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE ticket_service_lines ADD COLUMN IF NOT EXISTS is_taxable BOOLEAN NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION ticket_line_taxable_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.service_id IS NOT NULL AND NEW.product_id IS NULL THEN
    SELECT coalesce(s.is_taxable, true) INTO NEW.is_taxable FROM services s WHERE s.id = NEW.service_id AND s.tenant_id = NEW.tenant_id;
    IF NEW.is_taxable IS NULL THEN NEW.is_taxable := true; END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS ticket_line_taxable_snapshot ON ticket_service_lines;
CREATE TRIGGER ticket_line_taxable_snapshot BEFORE INSERT ON ticket_service_lines FOR EACH ROW EXECUTE FUNCTION ticket_line_taxable_snapshot();
