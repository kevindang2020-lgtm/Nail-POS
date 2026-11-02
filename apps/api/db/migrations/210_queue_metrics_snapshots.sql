-- 174_queue_metrics_snapshots.sql — periodic snapshots of Live Queue Monitor KPIs, so the monitor can show real
-- period-over-period trends instead of a fabricated "vs yesterday" percentage. Platform-wide rows use scope_key
-- 'platform' with a null tenant_id; tenant-scoped rows use the tenant UUID as scope_key. Metrics are stored as JSONB
-- (mirroring the existing pos_kpi_daily_snapshots pattern). Written by a scheduled capture; trends are computed by
-- comparing the current values to the most recent prior snapshot for the same scope. Append-only; never mutated.
CREATE TABLE IF NOT EXISTS queue_metrics_snapshots (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_key   TEXT NOT NULL,                 -- 'platform' or a tenant UUID string
  tenant_id   UUID,                          -- null = platform-wide
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metrics     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_queue_metrics_snap_scope_time ON queue_metrics_snapshots (scope_key, captured_at DESC);
