-- 565_webhook_dedupe_uniques.sql — BUILD_PLAN Phase 14 (Constitution 12 "webhook dedupe verified per provider").
--
-- The card-processor webhook (POST /webhooks/payments/:processor) dedupes an event by its id (payment_gateway_events,
-- uq_payment_gateway_events_processed, 538) — but an event WITHOUT an id, or two deliveries racing past the check, were
-- deduped only by a SELECT-then-INSERT on the money row: two concurrent deliveries of one refund wrote two refunds, two of
-- one settlement batch wrote two batches (payment-webhook-dedupe.pgtest, concurrent case). The money key is now unique:
--   payment_refunds      (tenant_id, processor_refund_id)  — the processor's refund id (or the transaction id it falls back to)
--   payment_settlements  (tenant_id, settlement_id)        — the processor's batch / settlement id
-- (chargebacks already has uq_chargebacks_tenant_case (tenant_id, chargeback_id), 096.)
--
-- Through schema_apply_unique (538): a database that ALREADY holds duplicates does not fail the deploy — the constraint is
-- recorded in schema_deferred_constraints with the duplicate-group count, a plain index is built instead, and the Super
-- Admin Database page retries it once the duplicates are resolved (Constitution 1 §69–71).
DO $$ BEGIN
  PERFORM schema_apply_unique('payment_refunds', 'uq_payment_refunds_processor_refund', 'tenant_id, processor_refund_id',
    'processor_refund_id IS NOT NULL', 'idx_payment_refunds_tenant_processor_refund', '565_webhook_dedupe_uniques.sql');
  PERFORM schema_apply_unique('payment_settlements', 'uq_payment_settlements_settlement', 'tenant_id, settlement_id',
    'settlement_id IS NOT NULL', 'idx_payment_settlements_tenant_settlement', '565_webhook_dedupe_uniques.sql');
END $$;

-- The call-transcription webhook (POST /voice-transcription/webhook) metered a call's minutes into ai_usage_logs on EVERY
-- delivery: a provider retry of the same completed call billed it twice (ai-webhook-dedupe.pgtest). A usage row may now
-- carry an idempotency key (request_id, the column existed and nothing wrote it); the same key is metered once.
DO $$ BEGIN
  PERFORM schema_apply_unique('ai_usage_logs', 'uq_ai_usage_logs_request', 'tenant_id, package_code, request_id',
    'request_id IS NOT NULL', 'idx_ai_usage_logs_request', '565_webhook_dedupe_uniques.sql');
END $$;
