-- 640_sms_segment_accounting.sql — Payments / Twilio mandate (Oct 13 2026, wave 3) §77 (SMS billing counts SEGMENTS, not
-- logical messages), §87 (the status callback records the provider error code), §173 (provider cost attribution).
--
--   notifications — the SMS ledger (one row per logical message). Gains:
--     segment_count        what the provider reported (Twilio num_segments on send / NumSegments on the status callback)
--     provider_status      the provider's own last status word (queued / sent / delivered / undelivered / failed) — `status`
--                          stays the normalized one the screens show
--     provider_error_code  the provider's error code (e.g. Twilio 30007) for support — never shown to a customer (§136)
--     provider_cost_micros exact provider cost in millionths of a dollar when the provider reports it (NULL = unknown)
--   The verification ledger (sms_usage_records, migration 427) stays separate (§76: Verify and SMS are different cost models).
-- EXPAND-ONLY, idempotent, nullable columns (no rewrite). The index is small for most salons; on a very large
-- notifications table create it CONCURRENTLY first in production (this file then finds it present).
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS segment_count        INT,
  ADD COLUMN IF NOT EXISTS provider_status      TEXT,
  ADD COLUMN IF NOT EXISTS provider_error_code  TEXT,
  ADD COLUMN IF NOT EXISTS provider_cost_micros BIGINT;
CREATE INDEX IF NOT EXISTS idx_notifications_tenant_channel_created ON notifications (tenant_id, channel, created_at);
