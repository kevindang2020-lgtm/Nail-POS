-- 572_ticket_checkout_status.sql — Round 2 C (Oct 12 2026): the ticket's checkout-board status lives on the row.
-- KyselyCheckoutRepository kept it in a per-process Map: with two API replicas one process showed — and acted on — a
-- status another had already changed (sent to the customer display, reopened, a payment in progress). Paid stays where it
-- always was (tickets.status = 'paid', which wins on the board); this column holds the UNPAID board states.
-- EXPAND-ONLY: one nullable column (NULL = never moved on the board → derived from tickets.status, every legacy row), no
-- default, no rewrite. The vocabulary CHECK is added NOT VALID and validated separately (a scan without the write lock).
-- Writers: modules/checkout checkout.kysely.repository.ts only, through TICKET_CHECKOUT (checkout-lifecycles.ts).
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS checkout_status TEXT;
ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_checkout_status_check;
ALTER TABLE tickets ADD CONSTRAINT tickets_checkout_status_check
  CHECK (checkout_status IN ('ready_for_payment','sent_to_customer_display','payment_in_progress','failed','reopened')) NOT VALID;
ALTER TABLE tickets VALIDATE CONSTRAINT tickets_checkout_status_check;
