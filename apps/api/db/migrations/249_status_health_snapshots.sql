-- 189_status_health_snapshots.sql
-- Daily platform-health snapshots powering the 7-day Platform Health Trend + the Current Global Uptime comparison.
-- One row per calendar day; health_score is the documented weighted-availability score (see system-status-core.ts).
CREATE TABLE IF NOT EXISTS status_health_snapshots (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date DATE NOT NULL,
  health_score  NUMERIC(6,3) NOT NULL,
  uptime_pct    NUMERIC(6,3),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (health_score >= 0 AND health_score <= 100)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_status_health_snapshot_date ON status_health_snapshots (snapshot_date);
