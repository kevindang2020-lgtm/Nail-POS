-- 515_gift_card_payment_link.sql — which gift card paid (Oct 6 2026).
--
-- A gift-card redemption's ledger row recorded neither the ticket nor the payment it paid (gift_card_transactions has
-- had ticket_id / payment_id since migration 033; nothing ever wrote them), and the payment row did not say which card —
-- so the customer display and the front desk could only say "Gift card". Now:
--   • the redemption's ledger row names its ticket and its payment (the code writes them; in the card's own salon's
--     ledger — the issuing salon's for a network card, so no foreign key: the payment may belong to the redeeming salon);
--   • the payment keeps the last four of the card that paid (its printed number's, or its code's for a digital card).
-- Earlier redemptions stay as they were (nothing to link them by).
CREATE INDEX IF NOT EXISTS gift_card_transactions_payment_idx ON gift_card_transactions (payment_id) WHERE payment_id IS NOT NULL;

ALTER TABLE payments ADD COLUMN IF NOT EXISTS gift_card_last4 TEXT;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_gift_card_last4_shape') THEN
    ALTER TABLE payments ADD CONSTRAINT payments_gift_card_last4_shape
      CHECK (gift_card_last4 IS NULL OR (method = 'gift_card' AND gift_card_last4 ~ '^[A-Z0-9]{4}$'));
  END IF;
END $$;
