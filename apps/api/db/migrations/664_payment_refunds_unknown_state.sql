-- 664_payment_refunds_unknown_state.sql — mandate P0 §228/§223 (Oct 20 2026): a card refund whose answer was lost.
--
-- Before: when processor.refund() threw (timeout, network, 5xx) the reservation row was DELETED and the error re-thrown, and
-- the route's idempotency key was released on failure — so a retry reached CardPointe a second time, and a refund the
-- processor had already made was made again. Now the reservation stays, moves to status 'processing' (the machine's
-- "unknown" state), any further refund on that payment is refused until it settles, and the stranded-attempt sweep settles it
-- from the processor's own answer (or hands it to a human). Additive only.
ALTER TABLE payment_refunds ADD COLUMN IF NOT EXISTS stranded_at    TIMESTAMPTZ;   -- first time the sweep saw it unresolved
ALTER TABLE payment_refunds ADD COLUMN IF NOT EXISTS review_reason  TEXT;          -- set when a human must settle it
ALTER TABLE payment_refunds ADD COLUMN IF NOT EXISTS last_error     TEXT;          -- what the processor call said / threw (no secrets)
ALTER TABLE payment_refunds ADD COLUMN IF NOT EXISTS request_detail JSONB;         -- {serviceLineIds, tipRefunded} so a late settle reverses exactly the lines asked
ALTER TABLE payment_refunds ADD COLUMN IF NOT EXISTS settled_at     TIMESTAMPTZ;
ALTER TABLE payment_refunds ADD COLUMN IF NOT EXISTS settled_by     TEXT;          -- 'live' | 'sweep' | user id (manual)

CREATE INDEX IF NOT EXISTS idx_payment_refunds_processing
  ON payment_refunds (created_at) WHERE status = 'processing';
CREATE INDEX IF NOT EXISTS idx_payment_refunds_payment_status
  ON payment_refunds (tenant_id, payment_id, status);
