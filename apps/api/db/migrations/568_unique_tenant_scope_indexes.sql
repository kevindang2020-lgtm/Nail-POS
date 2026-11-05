-- migrate: no-transaction
-- 568_unique_tenant_scope_indexes.sql — BUILD_PLAN Phase 15 C (docs/UNIQUE_INDEX_TENANT_REVIEW.md). The build half of 567:
-- the card-processor webhook's claim index becomes per salon — (tenant_id, processor_type, event_id), same predicate —
-- and the platform-wide (processor_type, event_id) index from 538 is dropped. CONCURRENTLY, so the webhook ledger is never
-- write-locked: this file runs outside a transaction, one statement at a time; an interrupted build's INVALID index is
-- dropped by the runner before the retry, and a build whose name 567 DEFERRED (duplicates on this database) is skipped by
-- the runner and left to scripts/db-validate-constraints.mjs. The new index is in place before the old one goes, so no
-- delivery is ever unguarded. No code names either index in an ON CONFLICT target (the webhook catches 23505).
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_payment_gateway_events_tenant_processed ON payment_gateway_events (tenant_id, processor_type, event_id) WHERE event_id IS NOT NULL AND processed_at IS NOT NULL;
DROP INDEX CONCURRENTLY IF EXISTS uq_payment_gateway_events_processed;
