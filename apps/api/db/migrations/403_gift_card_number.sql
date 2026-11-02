-- 403_gift_card_number.sql — adds the human-facing 16-digit gift card number (spec §3).
-- Distinct from `code` (the internal 'GC-…' identifier) and `reference` (the masked display string): this is the
-- cryptographically-random, non-sequential 16-digit number a customer reads/types and a scanner/manual-entry resolves.
-- Globally unique (network cards may cross tenants). Nullable + partial unique index so existing cards (which predate
-- this column) coexist; new issuance populates it.
ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS card_number TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_gift_cards_card_number
  ON gift_cards (card_number) WHERE card_number IS NOT NULL;
