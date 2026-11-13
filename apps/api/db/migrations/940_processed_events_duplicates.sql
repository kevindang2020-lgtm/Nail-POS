-- 940_processed_events_duplicates.sql — extras TECH QUEUE 15 (round 10, Nov 13 2026): the idempotency / retry dashboard
-- (Super Admin › Jobs & Dead Letters) could show retries and dead letters, but a DUPLICATE delivery of a queue / message
-- event was absorbed by processed_events (consumer-runner status 'duplicate') without a trace. These two columns count,
-- per (consumer, event), how many times the same event arrived again after it was processed, and when it last did —
-- written in the duplicate path only, inside the same transaction; the event is still processed exactly once.
-- Additive; no backfill (earlier duplicates were never recorded, so they stay 0 — never guessed).
-- Rollback: ALTER TABLE processed_events DROP COLUMN duplicate_deliveries, DROP COLUMN last_duplicate_at;
ALTER TABLE processed_events ADD COLUMN IF NOT EXISTS duplicate_deliveries INTEGER NOT NULL DEFAULT 0;
ALTER TABLE processed_events ADD COLUMN IF NOT EXISTS last_duplicate_at TIMESTAMPTZ;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_processed_events_duplicates_nonneg') THEN
    ALTER TABLE processed_events ADD CONSTRAINT ck_processed_events_duplicates_nonneg CHECK (duplicate_deliveries >= 0);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_processed_events_dup ON processed_events (consumer_name, last_duplicate_at) WHERE last_duplicate_at IS NOT NULL;
