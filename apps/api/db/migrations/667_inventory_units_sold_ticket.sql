-- 667_inventory_units_sold_ticket.sql — B-17 (Oct 20 2026): a retail sale stamps the units it sold with the ticket and the
-- ticket line, so a removed line, a void or a refund can put EXACTLY those units back (sold → unopened, a customer_return
-- movement against the ticket). Expand only (nullable columns, one partial index); nothing is backfilled — a unit sold
-- before this migration carries no ticket and is returned by a manual adjustment, as before.
ALTER TABLE inventory_units ADD COLUMN IF NOT EXISTS sold_ticket_id UUID;
ALTER TABLE inventory_units ADD COLUMN IF NOT EXISTS sold_line_id UUID;
CREATE INDEX IF NOT EXISTS idx_inventory_units_sold_ticket ON inventory_units (tenant_id, sold_ticket_id) WHERE sold_ticket_id IS NOT NULL;
