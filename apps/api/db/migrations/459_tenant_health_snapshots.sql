-- 459_tenant_health_snapshots.sql — Constitution 11 §344 (tenant health snapshot) + §156 (tenant health dashboard).
--
-- The per-salon health read (§293, GET /super-admin/tenants/:id/health) evaluates ONE salon on demand. A list of every
-- salon cannot run that live per row, so an hourly sweep stores the result here and the list reads the latest row per
-- salon. §157: explicit components, not an opaque score — each component keeps its own status column.
--
-- realtime_status is §344's field but the evaluator has no realtime component yet: it stays NULL ("not measured"),
-- never a guessed HEALTHY. snapshot_hour + the unique index make the sweep idempotent: two workers (or a retried run)
-- in the same hour insert one row per salon, not two.
CREATE TABLE IF NOT EXISTS tenant_health_snapshots (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  observed_at            TIMESTAMPTZ NOT NULL,
  snapshot_hour          TIMESTAMPTZ NOT NULL,
  overall_status         TEXT NOT NULL,
  payments_status        TEXT NOT NULL,
  communications_status  TEXT NOT NULL,
  booking_status         TEXT NOT NULL,
  devices_status         TEXT NOT NULL,
  jobs_status            TEXT NOT NULL,
  realtime_status        TEXT NULL,
  failed_queries         TEXT[] NOT NULL DEFAULT '{}',
  components             JSONB NOT NULL DEFAULT '{}'::jsonb,   -- reason + details per component (ids and counts only)
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tenant_health_snapshots_status_vocab CHECK (
    overall_status IN ('HEALTHY','DEGRADED','MISCONFIGURED','RATE_LIMITED','OUTAGE','UNKNOWN')
    AND payments_status IN ('HEALTHY','DEGRADED','MISCONFIGURED','RATE_LIMITED','OUTAGE','UNKNOWN')
    AND communications_status IN ('HEALTHY','DEGRADED','MISCONFIGURED','RATE_LIMITED','OUTAGE','UNKNOWN')
    AND booking_status IN ('HEALTHY','DEGRADED','MISCONFIGURED','RATE_LIMITED','OUTAGE','UNKNOWN')
    AND devices_status IN ('HEALTHY','DEGRADED','MISCONFIGURED','RATE_LIMITED','OUTAGE','UNKNOWN')
    AND jobs_status IN ('HEALTHY','DEGRADED','MISCONFIGURED','RATE_LIMITED','OUTAGE','UNKNOWN')
    AND (realtime_status IS NULL OR realtime_status IN ('HEALTHY','DEGRADED','MISCONFIGURED','RATE_LIMITED','OUTAGE','UNKNOWN'))
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_tenant_health_snapshots_hour ON tenant_health_snapshots (tenant_id, snapshot_hour);
CREATE INDEX IF NOT EXISTS idx_tenant_health_snapshots_latest ON tenant_health_snapshots (tenant_id, observed_at DESC);
