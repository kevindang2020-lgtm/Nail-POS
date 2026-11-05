-- 457_owner_alert_audience.sql — some owner alerts must reach the OWNER alone.
--
-- Owner alerts are readable by OWNER and MANAGER (owner.alerts.view). A fraud finding that names an employee — refunds
-- spread across payments — could name a MANAGER, who would then read their own alert (and could acknowledge or dismiss
-- it). audience = 'owner' restricts an alert to owners on every read AND status-change path. Every existing alert keeps
-- 'all' — nothing anyone sees today changes.
ALTER TABLE owner_alerts ADD COLUMN IF NOT EXISTS audience TEXT NOT NULL DEFAULT 'all';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'owner_alerts_audience_check') THEN
    ALTER TABLE owner_alerts ADD CONSTRAINT owner_alerts_audience_check CHECK (audience IN ('all', 'owner'));
  END IF;
END $$;
