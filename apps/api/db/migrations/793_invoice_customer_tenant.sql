-- 793_invoice_customer_tenant.sql — Invoices guide audit (Nov 4 2026): the legacy POST /pos/invoices took any customerId and
-- the read joined customers on id alone, so an invoice could name — and show — another salon's customer. The service now
-- refuses a customer outside the salon and the reads join on the salon; this trigger makes the database refuse it too.
-- Existing rows are not rewritten (the trigger checks writes only).
DROP TRIGGER IF EXISTS trg_tc_invoices__customer_id ON invoices;
CREATE TRIGGER trg_tc_invoices__customer_id BEFORE INSERT OR UPDATE OF tenant_id, customer_id ON invoices FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('customers', 'customer_id');
