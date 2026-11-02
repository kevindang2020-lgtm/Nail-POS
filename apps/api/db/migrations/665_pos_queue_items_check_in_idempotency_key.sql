-- 665_pos_queue_items_check_in_idempotency_key.sql — mandate §31 (Oct 20 2026): the walk-in check-in's client idempotency
-- key (one per "Complete Check-In" tap) used to live in an in-process Map, so a retry that landed on another API replica got
-- "already checked in" (409) instead of the original entry. The key now lives on the queue row, like serving_idempotency_key
-- and tech_queue_idempotency_key: a retry anywhere finds the entry it created. Additive only.
ALTER TABLE pos_queue_items ADD COLUMN IF NOT EXISTS check_in_idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_queue_checkin_key ON pos_queue_items (tenant_id, check_in_idempotency_key) WHERE check_in_idempotency_key IS NOT NULL;
