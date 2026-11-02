-- 489_gift_card_transaction_branch.sql — Functional Decision 31: gift-card value is the TENANT's liability; each branch
-- recognizes what it sells and what it redeems, and branches clear the difference between them.
-- gift_cards.branch_id is where a card was sold; nothing recorded where a card was REDEEMED (or reloaded / adjusted), so
-- inter-branch clearing could not be reported. Every ledger row now carries the branch where it happened. Cross-salon
-- (shared-program) redemptions keep NULL here — they are booked at the issuing salon and settled through
-- gift_card_clearing_entries (406), which already names both salons.
ALTER TABLE gift_card_transactions ADD COLUMN IF NOT EXISTS branch_id UUID;
COMMENT ON COLUMN gift_card_transactions.branch_id IS 'Branch where this ledger event happened (Decision 31). NULL = unknown (pre-489 rows that could not be attributed) or a cross-salon redemption.';

-- Backfill what can be known: a sale/activation happened at the card's selling branch; anything tied to a ticket happened
-- at that ticket's branch. Everything else stays NULL and is reported as "not attributed", never guessed.
UPDATE gift_card_transactions t SET branch_id = g.branch_id
  FROM gift_cards g WHERE t.branch_id IS NULL AND t.gift_card_id = g.id AND t.tenant_id = g.tenant_id AND t.type IN ('issue', 'activate');
UPDATE gift_card_transactions t SET branch_id = k.branch_id
  FROM tickets k WHERE t.branch_id IS NULL AND t.ticket_id IS NOT NULL AND k.id = t.ticket_id AND k.tenant_id = t.tenant_id;

CREATE INDEX IF NOT EXISTS idx_gift_card_tx_tenant_branch_created ON gift_card_transactions (tenant_id, branch_id, created_at);
