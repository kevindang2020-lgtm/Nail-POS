-- 910_deal_schedule_alerts.sql — Deals & Offers backlog · 06 "Upcoming Expiration Alerts" (round 10, Nov 13 2026).
-- The deals lifecycle sweep tells managers, in the salon's EXISTING alert feed (owner_alerts, category 'deal_schedule'),
-- about an offer starting within 24 hours, ending within 48 hours, or with few uses left. One alert per dedupe key
-- (deal + kind + the date it is about), so repeated sweeps never stack a second alert. No new table, no new column.
CREATE UNIQUE INDEX IF NOT EXISTS uq_owner_alerts_deal_schedule ON owner_alerts (tenant_id, (metadata->>'dedupeKey'))
  WHERE category = 'deal_schedule';
