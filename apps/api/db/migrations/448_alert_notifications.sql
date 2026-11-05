-- 448_alert_notifications.sql — Constitution 11 §262–265, §350–351: paging state on platform alerts.
--
-- Health alerts landed on the Super Admin screen only, so a 3 a.m. outage waited for someone to look (§263: every P1
-- must reach a human). These columns make paging idempotent across restarts and across API instances: a notification
-- is CLAIMED with a conditional UPDATE, so exactly one instance sends it.
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS notified_severity     TEXT;          -- highest severity already paged for this episode
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS notified_at           TIMESTAMPTZ;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS reminder_sent_at      TIMESTAMPTZ;   -- §264: one reminder for an unacknowledged P1
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS recovery_notified_at  TIMESTAMPTZ;   -- "resolved" sent for an alert that was paged
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS notify_failures       INTEGER NOT NULL DEFAULT 0;
