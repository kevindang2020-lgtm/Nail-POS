-- 182_utilization_snapshots.sql — point-in-time platform utilization snapshots (one per calendar day; re-capturing the
-- same day overwrites). Feeds the Plan Utilization Trend panel with a real time series as snapshots accrue.

CREATE TABLE IF NOT EXISTS utilization_snapshots (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  captured_on   date NOT NULL UNIQUE,
  tenants       int NOT NULL DEFAULT 0,
  tenants_near  int NOT NULL DEFAULT 0,
  tenants_over  int NOT NULL DEFAULT 0,
  avg_max_pct   int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);
