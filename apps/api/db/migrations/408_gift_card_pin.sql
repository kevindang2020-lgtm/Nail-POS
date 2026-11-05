-- 408_gift_card_pin.sql — optional PIN for physical gift cards (spec §3/§12). Stored as a hash bound to the card's code
-- (never the clear PIN); NULL means no PIN is set (all digital/blank cards, unchanged). When present, the PIN is required
-- at redemption, so knowing only the printed number can't drain the card ("card draining" protection).
ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS card_pin_hash TEXT;
