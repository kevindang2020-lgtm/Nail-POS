-- 663_notifications_simulated_status.sql — P-11 (wave 4 pilot): a text or e-mail "sent" by the development mock sender is
-- recorded as 'simulated', never as 'sent' (it never left the process, is never metered and never counted as usage).
-- A channel with no provider in production is recorded as 'blocked' with failure_reason 'not_configured' (existing state).
-- Forward-only: the new set is a superset, so every existing row already satisfies it.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_status_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_status_check CHECK (status IN ('sent','failed','blocked','delivered','simulated'));
