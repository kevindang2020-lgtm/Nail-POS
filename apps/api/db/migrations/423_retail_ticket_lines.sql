-- 423_retail_ticket_lines.sql — the one schema change that makes retail actually sellable.
--
-- == THE GAP =================================================================================================
--
-- Everything downstream of a retail sale already exists and has for months:
--   • ticket_service_lines.line_kind understands 'retail' (mig 131) and Checkout's Upsell Mix + "Potential Revenue"
--     already split a retail slice out of services from it;
--   • the compensation engine already separates retail lines and applies the salon's configured retail commission
--     (percent-of-gross or fixed-per-item) instead of the service rate;
--   • inventory_products carries is_retail / retail_price_cents / cost_cents, and MovementType already has
--     'retail_sale', which reports and the demand forecaster read.
--
-- What has never existed is a way to WRITE one. The only line writer inserts a service line, and this table's
-- service_id is NOT NULL with no product column — so a retail product physically cannot be put on a ticket. The
-- salon can stock retail, price it, and report on it, but cannot sell it.
--
-- == THE CHANGE ==============================================================================================
--
-- Additive and safe on existing data: every existing row has a service_id, so dropping NOT NULL changes nothing
-- about them, and the new CHECK passes for all of them. The constraint is what keeps the table honest going
-- forward — a line is EITHER a service line OR a retail line, never neither.

ALTER TABLE ticket_service_lines ALTER COLUMN service_id DROP NOT NULL;
ALTER TABLE ticket_service_lines ADD COLUMN IF NOT EXISTS product_id UUID;

-- A line must be attributable to something sellable. Without this, a null/null row would silently price at
-- whatever the snapshot said and belong to no catalog item.
ALTER TABLE ticket_service_lines DROP CONSTRAINT IF EXISTS ticket_service_lines_sellable;
ALTER TABLE ticket_service_lines ADD  CONSTRAINT ticket_service_lines_sellable
  CHECK (service_id IS NOT NULL OR product_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_ticket_lines_product
  ON ticket_service_lines (tenant_id, branch_id, product_id)
  WHERE product_id IS NOT NULL;
