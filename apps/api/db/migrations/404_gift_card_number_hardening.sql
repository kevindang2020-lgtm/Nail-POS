-- 404_gift_card_number_hardening.sql — stop storing the 16-digit gift card number in the clear (spec §3/§12/§32).
-- The human-facing number is shown once at issuance (receipt / physical card) but must never be persisted or exposed.
-- Instead we keep: card_number_hash (sha256 hex of the normalized digits, for lookup on scan / manual entry) and
-- card_number_last4 (for the masked '•••• •••• •••• NNNN' display). The plaintext column is backfilled into these and
-- then nulled. Uniqueness moves to the hash (a deterministic hash collides iff the numbers match), preserving the
-- "no two cards share a number" guarantee that issuance relies on. pgcrypto (digest) is enabled in 001.
ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS card_number_hash  TEXT;
ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS card_number_last4 TEXT;

-- Backfill any existing plaintext numbers into hash + last4 before we drop them.
UPDATE gift_cards
   SET card_number_hash  = encode(digest(card_number, 'sha256'), 'hex'),
       card_number_last4 = right(card_number, 4)
 WHERE card_number IS NOT NULL
   AND card_number_hash IS NULL;

-- Remove the plaintext number from the row — it is no longer stored at rest.
UPDATE gift_cards SET card_number = NULL WHERE card_number IS NOT NULL;

-- Uniqueness now lives on the hash (globally unique; network cards may cross tenants). The old plaintext unique index
-- (uq_gift_cards_card_number) becomes inert since the column is always NULL — left in place, it indexes nothing.
CREATE UNIQUE INDEX IF NOT EXISTS uq_gift_cards_card_number_hash
  ON gift_cards (card_number_hash) WHERE card_number_hash IS NOT NULL;
