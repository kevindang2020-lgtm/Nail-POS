-- migrate: no-transaction
-- 550_payments_processing_index.sql — BUILD_PLAN Phase 11 (Constitution 4 §116). The stranded-attempt sweep scans card
-- payments still in 'processing' every five minutes; a partial index keeps that scan to the handful of in-flight rows.
-- CONCURRENTLY (outside a transaction, see 546) so building it never blocks writes on the payments table.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_processing_created ON payments (created_at) WHERE status = 'processing';
