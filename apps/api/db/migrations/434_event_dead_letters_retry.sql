-- 434: Constitution 8 §48–50 — the dead-letter row doubles as the per-(consumer,event) retry ledger.
-- A TRANSIENT failure sits at status 'retrying' with next_attempt_at set by exponential backoff + jitter;
-- after max attempts it becomes 'open' (a true dead letter). PERMANENT / SECURITY / DATA_INTEGRITY go
-- straight to 'open'. One row per (consumer_name, event_id) — the UNIQUE from 433 — so retries UPDATE it.
ALTER TABLE event_dead_letters ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_dlq_retry_due ON event_dead_letters (next_attempt_at) WHERE status = 'retrying';
