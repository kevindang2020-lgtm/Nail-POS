-- 549_payment_attempt_stranded.sql — BUILD_PLAN Phase 11 (Constitution 4 §116, payment provider failure). Idempotent.
--
-- A card attempt can be left in 'processing' for ever when the process dies (deploy, crash, network loss) between the
-- processor call and the write that records its answer. The stranded-attempt sweep
-- (modules/checkout/src/checkout/payment-attempt-sweep*.ts, job `payments.stranded_attempts`) finds those rows and
-- resolves them ONLY from the processor's own answer (inquire by order id through the existing adapters). When the
-- processor cannot answer — no inquiry API, not connected, unreachable for too long, or it says the card WAS charged
-- but nothing here recorded it — the attempt becomes 'needs_review' and the owner + Super Admin are alerted. Nothing is
-- ever charged, voided or refunded on a guess.
--
--   payment_attempts.stranded_at  when the sweep first found the attempt stranded (set with the resolution)
--   payment_attempts.resolution   what the processor said (vocabulary below) — NULL while the live flow owns the row
--   payment_attempts.resolved_at  when the sweep resolved it
--   payments.stranded_at          a straight card payment the sweep could not verify: set ONCE, so the alert is raised
--                                 once; the row keeps status 'processing' (it still blocks a second charge) and the sweep
--                                 keeps asking the processor on later ticks.

ALTER TABLE payment_attempts ADD COLUMN IF NOT EXISTS stranded_at TIMESTAMPTZ;
ALTER TABLE payment_attempts ADD COLUMN IF NOT EXISTS resolution TEXT;
ALTER TABLE payment_attempts ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS stranded_at TIMESTAMPTZ;

-- Status vocabulary: 538's list + 'needs_review' + the Owner & Manager Payment App's §18 state machine
-- (modules/checkout/src/mobile-checkout/payment-attempt-state.ts writes those states to THIS table; 538's list missed
-- them, so a validated check would have refused the first mobile transition past 'created').
ALTER TABLE payment_attempts DROP CONSTRAINT IF EXISTS chk_payment_attempts_status_vocab;
DO $$
BEGIN
  PERFORM schema_apply_check('payment_attempts', 'chk_payment_attempts_status_vocab',
    'status IN (''cancelled'', ''created'', ''declined'', ''failed'', ''pending'', ''processing'', ''refunded'', ''settled'', ''succeeded'', ''void'', ''voided'', '
    || '''needs_review'', '
    || '''readiness_checking'', ''ready'', ''reader_initializing'', ''awaiting_customer_tap'', ''card_detected'', ''authorization_pending'', ''authorized'', '
    || '''confirmation_pending'', ''confirmed'', ''canceled'', ''timed_out'', ''unknown'', ''reconciliation_required'', ''partially_refunded'')',
    '549_payment_attempt_stranded.sql');
  PERFORM schema_apply_check('payment_attempts', 'chk_payment_attempts_resolution_vocab',
    'resolution IS NULL OR resolution IN (''provider_approved_recorded'', ''provider_declined'', ''provider_not_found'', ''provider_approved_unrecorded'', '
    || '''provider_ambiguous'', ''provider_no_inquiry'', ''processor_not_connected'', ''provider_unreachable'')',
    '549_payment_attempt_stranded.sql');
END $$;

-- The sweep's scan: only the (few) rows still in flight. payment_attempts is small; the payments index is in 550
-- (CREATE INDEX CONCURRENTLY, outside a transaction, so the money table is never write-locked by this deploy).
CREATE INDEX IF NOT EXISTS idx_payment_attempts_processing ON payment_attempts (created_at) WHERE status = 'processing';
CREATE INDEX IF NOT EXISTS idx_payment_attempts_needs_review ON payment_attempts (tenant_id, created_at) WHERE status = 'needs_review';
