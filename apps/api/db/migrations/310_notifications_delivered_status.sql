-- 310_notifications_delivered_status.sql — extend the notifications log so Twilio delivery-status callbacks can record
-- an actual 'delivered' outcome (not just the send attempt). The original CHECK only allowed sent/failed/blocked; a
-- delivery receipt from the carrier is a distinct, useful state (the salon learns whether a reminder truly landed).
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_status_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_status_check CHECK (status IN ('sent','failed','blocked','delivered'));
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_notifications_provider_id ON notifications (provider_id);
