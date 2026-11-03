-- 782_ai_business_alert_archive.sql — AI Business Alerts (Nov 3 audit). Additive only.
-- Deleting a rule used to CASCADE away its whole evaluation history (ai_business_alert_events.alert_id ON DELETE CASCADE),
-- which the newer Business Alerts guide forbids. A rule that has history is now ARCHIVED (archived_at, inactive) instead;
-- only a rule that was never evaluated is physically deleted.
-- Rollback: ALTER TABLE ai_business_alerts DROP COLUMN archived_at;
ALTER TABLE ai_business_alerts ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
