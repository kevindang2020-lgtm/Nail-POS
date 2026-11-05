-- 514_checkout_hold_and_register.sql — POS Checkout's "Hold Ticket" and "Move to Front Desk" (Oct 6 2026). Both buttons
-- only showed a message; neither held nor moved anything.
--   checkout_held_at / _by   the front desk set the ticket aside: it leaves the "ready for payment" queue with its items,
--                            tip and discounts as they are, until it is resumed or paid (paying clears the hold).
--   checkout_register_id     the register (pos_stations, migration 511) the ticket is to be paid at; "Move to Front Desk"
--                            sets it, and the register's name is shown on the ticket (station_label, migration 017).
-- Idempotent.
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS checkout_held_at TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS checkout_held_by UUID;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS checkout_register_id UUID REFERENCES pos_stations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS ix_tickets_checkout_register ON tickets (tenant_id, checkout_register_id) WHERE checkout_register_id IS NOT NULL;
