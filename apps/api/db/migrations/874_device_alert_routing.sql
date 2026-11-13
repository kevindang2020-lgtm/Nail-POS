-- 874_device_alert_routing.sql — Device Integration Logs backlog · 05 (Nov 12 2026): automated device / integration alert
-- routing writes the salon's EXISTING alert feed (owner_alerts, category 'device_integration'). One OPEN alert per dedupe key
-- (rule + device class / source), so two evaluators racing can never stack a second open alert; a repeat detection updates
-- the open one. No new table, no new column.
CREATE UNIQUE INDEX IF NOT EXISTS uq_owner_alerts_device_open ON owner_alerts (tenant_id, (metadata->>'dedupeKey'))
  WHERE category = 'device_integration' AND status IN ('new', 'acknowledged', 'in_progress');
