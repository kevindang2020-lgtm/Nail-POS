-- migrate: no-transaction
-- 714_terminals_gift_cards_indexes.sql — Payment Terminals and Gift Cards mandates (Oct 29 2026): the newest-first numbered
-- lists (created_at DESC, id DESC), the masked-suffix lookup and each card's ledger page read one of these. Index-only,
-- built CONCURRENTLY so a live salon is never blocked; idempotent.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_gift_cards_tenant_created_id ON gift_cards (tenant_id, created_at DESC, id DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_gift_cards_tenant_last4 ON gift_cards (tenant_id, card_number_last4) WHERE card_number_last4 IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_gift_card_tx_card_created ON gift_card_transactions (tenant_id, gift_card_id, created_at DESC, id DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_tenant_created_id ON payments (tenant_id, created_at DESC, id DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_tenant_device ON payments (tenant_id, device_id) WHERE device_id IS NOT NULL;
