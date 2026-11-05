-- 183_campaign_metric_snapshots.sql
-- Daily platform-wide campaign metric snapshots, so Campaign Performance Trend (delivery/open/click rates over time)
-- becomes real. Rates use consistent denominators: delivery = delivered ÷ attempted; open = opened ÷ delivered;
-- click = clicked ÷ delivered. One row per day.
CREATE TABLE IF NOT EXISTS campaign_metric_snapshots (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date DATE NOT NULL,
  attempted     INTEGER NOT NULL DEFAULT 0,
  delivered     INTEGER NOT NULL DEFAULT 0,
  opened        INTEGER NOT NULL DEFAULT 0,
  clicked       INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (attempted >= 0 AND delivered >= 0 AND opened >= 0 AND clicked >= 0 AND delivered <= attempted)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_metric_snapshot_date ON campaign_metric_snapshots (snapshot_date);
CREATE INDEX IF NOT EXISTS ix_metric_snapshot_date ON campaign_metric_snapshots (snapshot_date DESC);
