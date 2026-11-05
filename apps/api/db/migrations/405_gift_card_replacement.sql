-- 405_gift_card_replacement.sql — lost/stolen replacement lineage (spec §22). When a card is replaced, its balance
-- moves to a brand-new card via ledger 'transfer' entries and the original is retired. These columns record the lineage
-- in both directions so reporting/support can trace a card to its replacement and back — we never edit a card number.
ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS replaced_by_card_id    UUID;  -- on the retired card -> its replacement
ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS replacement_of_card_id UUID;  -- on the new card -> the card it replaced

-- 'replaced' is the terminal state of a retired-and-superseded card (distinct from void/canceled/redeemed).
ALTER TABLE gift_cards DROP CONSTRAINT IF EXISTS gift_cards_status_check;
ALTER TABLE gift_cards ADD CONSTRAINT gift_cards_status_check CHECK (status IN (
  'draft','pending_payment','active','scheduled','delivered','claimed','partially_redeemed','redeemed',
  'suspended','frozen','canceled','refunded','expired','lost_stolen','pending_review','replaced','void'
));
