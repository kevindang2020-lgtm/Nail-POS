-- 174_platform_request_metrics.sql — lightweight per-request telemetry for platform API health (M14).
-- Each handled HTTP request appends one row (method, route pattern, status, latency). The Super Admin Analytics
-- "System Health" module aggregates a recent window into API success rate + p50/p95 latency. This is REAL request
-- telemetry: it is empty until the HealthMetricsInterceptor is mounted and traffic flows. We deliberately do NOT
-- derive "uptime %" here — request success ≠ availability; uptime needs separate heartbeat monitoring.
--
-- Volume note: the interceptor records fire-and-forget (never blocks or fails a request) and supports sampling via
-- HEALTH_METRICS_SAMPLE_RATE. A future optimization can batch/roll up; v1 keeps one row per (sampled) request.

CREATE TABLE IF NOT EXISTS platform_request_metrics (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  method       TEXT NOT NULL,
  route        TEXT NOT NULL,                 -- route PATTERN (e.g. /super-admin/analytics), never the raw URL with ids
  status_code  INTEGER NOT NULL,
  latency_ms   INTEGER NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS platform_request_metrics_created ON platform_request_metrics (created_at DESC);
