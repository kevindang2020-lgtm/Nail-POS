-- 788_payments_register.sql — D15 Cash Drawer guide (Nov 4 2026): cash belongs to the REGISTER that took it. A payment
-- carried no register, so every register of a multi-register location showed the whole location's cash and could never
-- balance. payments.register_id is the register (pos_stations.id, as text — the drawer's register_id vocabulary) the ticket
-- was checked out at when the payment was written; filled by trigger from tickets.checkout_register_id so every writer
-- (POS, mobile checkout, webhooks) records it without code changes. A payment with no register (no stations set up, or
-- written before this migration) stays NULL and belongs to the location's 'main' drawer — exactly today's behaviour.
-- Additive only. Rollback: DROP TRIGGER trg_payments_register ON payments; DROP FUNCTION payments_fill_register();
--   DROP INDEX ix_payments_cash_register; ALTER TABLE payments DROP COLUMN register_id;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS register_id TEXT;
CREATE OR REPLACE FUNCTION payments_fill_register() RETURNS trigger AS $$
BEGIN
  IF NEW.register_id IS NULL AND NEW.ticket_id IS NOT NULL THEN
    SELECT t.checkout_register_id::text INTO NEW.register_id FROM tickets t WHERE t.id = NEW.ticket_id AND t.tenant_id = NEW.tenant_id;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_payments_register ON payments;
CREATE TRIGGER trg_payments_register BEFORE INSERT ON payments FOR EACH ROW EXECUTE FUNCTION payments_fill_register();
CREATE INDEX IF NOT EXISTS ix_payments_cash_register ON payments (tenant_id, branch_id, register_id, created_at) WHERE method = 'cash';
