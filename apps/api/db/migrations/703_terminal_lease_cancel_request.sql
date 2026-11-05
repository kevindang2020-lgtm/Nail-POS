-- 703_terminal_lease_cancel_request.sql — POS "Cancel on terminal" works whichever API server receives it (Nov 5 2026).
--
-- Bolt's /api/v2/cancel must be sent on the SESSION that started the charge, and that session key lives only in the memory
-- of the API process running authCard. With more than one API replica the Cancel request can land on another server.
-- Instead of sharing the session key (a credential) through the database, the Cancel request is RECORDED on the
-- terminal's lease row; the server holding the charge polls its own lease while the customer is at the terminal and
-- sends the cancel itself. ticket_id lets the POS find the lease of the ticket it is charging.
ALTER TABLE payment_terminal_leases ADD COLUMN IF NOT EXISTS ticket_id           TEXT;
ALTER TABLE payment_terminal_leases ADD COLUMN IF NOT EXISTS cancel_requested_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_payment_terminal_leases_ticket ON payment_terminal_leases (tenant_id, ticket_id) WHERE ticket_id IS NOT NULL;
