-- 402_gift_card_sale_ticket.sql — payment-first gift-card SALE at the POS.
--
-- A gift card sold at the POS is created in 'pending_payment' status (no stored value, no ledger 'issue') and linked
-- to the checkout ticket that pays for it. When that ticket is paid, the checkout afterPaid hook activates the card
-- (status → active, balance = purchased_cents, ledger 'activate'). This makes "activate only after payment succeeds"
-- structural: an unpaid ticket leaves the card pending and worthless. Additive; no data moved.
ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS sale_ticket_id UUID;   -- the ticket whose payment activates this card
-- Look up a ticket's pending sales quickly at payment time.
CREATE INDEX IF NOT EXISTS idx_gift_cards_sale_ticket ON gift_cards (tenant_id, sale_ticket_id) WHERE sale_ticket_id IS NOT NULL;
