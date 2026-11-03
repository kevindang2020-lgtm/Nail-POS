-- 783_ai_business_alert_failed_events.sql — Business Alerts guide (newer, Nov 3 2026): an evaluation that could not read its
-- numbers is RECORDED as 'failed' (with the reason) instead of only throwing, so the history shows it. Additive: widens a CHECK.
-- Rollback: delete the 'failed' rows, then restore the 4-value CHECK.
ALTER TABLE ai_business_alert_events DROP CONSTRAINT IF EXISTS ai_business_alert_events_state_change_check;
ALTER TABLE ai_business_alert_events ADD CONSTRAINT ai_business_alert_events_state_change_check
  CHECK (state_change IN ('triggered', 'recovered', 'unchanged', 'not_evaluated', 'failed'));
