-- 713_terminals_gift_cards_screens.sql — Payment Terminals and Gift Cards mandates (Oct 29 2026). EXPAND-ONLY, idempotent;
-- every new column is nullable (no rewrite, no backfill of history).
--
-- Gift Cards §11 "two rapid taps of Issue must never generate duplicate paid cards": the Issue Gift Card request carries
-- an idempotency key, unique per salon — a retried or double-tapped Issue finds the card (and its ticket) it already made.
ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS issue_idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_gift_cards_issue_key ON gift_cards (tenant_id, issue_idempotency_key) WHERE issue_idempotency_key IS NOT NULL;
-- Gift Cards §15: a void stores its reason, actor and time on the card (the paired gift_card_adjustments row keeps the
-- financial before / after; the ledger keeps the movement). The void itself is unchanged: a compensating ledger row.
ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS void_reason TEXT;
ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ;
ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS voided_by_user_id UUID;
