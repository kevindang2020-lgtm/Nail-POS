-- 561_telemetry_store.sql — BUILD_PLAN Phase 14 A (Constitution 11 §291 request diagnostics, §292 correlation diagnostics,
-- trace ↔ log linking, D7). The platform's OWN short-retention log + trace store, so Super Admin can find "Reference:
-- req_01J…" or a correlation chain without a third-party log product.
--
-- WHAT LANDS HERE. Written ONLY by the telemetry sink (packages/observability/src/telemetry-store.ts) through the worker
-- pool, batched and fail-open: every log line at WARN and above, a sampled fraction of INFO (TELEMETRY_LOG_SAMPLE, default
-- 0.1; all lines of a request that errored or whose trace is stored), and the spans of stored traces (TELEMETRY_TRACE_SAMPLE,
-- default 0.1). Every string is redacted BEFORE the insert (redaction.ts + the store's free-text scrub: emails, phone
-- numbers, card numbers, bearer tokens / JWTs); request bodies, headers and query strings are never written.
--
-- PLAIN TABLES + A TIME INDEX + THE HOURLY RETENTION SWEEP, not daily partitions. Why: (1) a partitioned table needs a
-- maintenance job that creates tomorrow's partition; when that job misses a day the INSERTs fail — a new way for
-- telemetry to break, which §286 forbids; (2) volume is bounded at the source (the sink's per-process rows-per-minute cap,
-- TELEMETRY_STORE_MAX_ROWS_PER_MIN, default 3000 → ≤ 4.3 M rows/day/process), which batched ctid deletes clear easily
-- every hour; (3) the existing retention, ownership and Kysely tooling handle plain tables. If volume ever outgrows that,
-- the switch to RANGE (ts) partitions is a migration with no API change. Retention: 14 days (TELEMETRY_STORE_RETENTION_DAYS,
-- retention-policy.json; apps/api/src/observability/telemetry-store.ts deletes hourly).
--
-- No foreign keys on purpose: a telemetry row must never block (or be blocked by) deleting a tenant, and the sink never
-- reads before it writes. tenant_id is NULLable (platform requests, public routes, system jobs) and only ever a UUID.
CREATE TABLE IF NOT EXISTS telemetry_log_events (
  id              bigserial PRIMARY KEY,
  ts              timestamptz NOT NULL,
  level           text NOT NULL CHECK (level IN ('trace', 'debug', 'info', 'warn', 'error', 'fatal')),
  service         text NOT NULL CHECK (length(service) <= 64),
  process_role    text NOT NULL DEFAULT 'all' CHECK (length(process_role) <= 32),
  request_id      text CHECK (request_id IS NULL OR length(request_id) <= 128),
  correlation_id  text CHECK (correlation_id IS NULL OR length(correlation_id) <= 128),
  trace_id        text CHECK (trace_id IS NULL OR trace_id ~ '^[0-9a-f]{32}$'),
  span_id         text CHECK (span_id IS NULL OR span_id ~ '^[0-9a-f]{16}$'),
  tenant_id       uuid,
  route           text CHECK (route IS NULL OR length(route) <= 300),
  status          integer CHECK (status IS NULL OR status BETWEEN 0 AND 999),
  duration_ms     integer CHECK (duration_ms IS NULL OR duration_ms >= 0),
  msg             text NOT NULL CHECK (length(msg) <= 500),
  fields          jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS telemetry_log_events_ts_idx ON telemetry_log_events (ts);
CREATE INDEX IF NOT EXISTS telemetry_log_events_request_idx ON telemetry_log_events (request_id, ts) WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS telemetry_log_events_correlation_idx ON telemetry_log_events (correlation_id, ts) WHERE correlation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS telemetry_log_events_trace_idx ON telemetry_log_events (trace_id, ts) WHERE trace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS telemetry_log_events_tenant_idx ON telemetry_log_events (tenant_id, ts) WHERE tenant_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS telemetry_spans (
  id              bigserial PRIMARY KEY,
  trace_id        text NOT NULL CHECK (trace_id ~ '^[0-9a-f]{32}$'),
  span_id         text NOT NULL CHECK (span_id ~ '^[0-9a-f]{16}$'),
  parent_span_id  text CHECK (parent_span_id IS NULL OR parent_span_id ~ '^[0-9a-f]{16}$'),
  name            text NOT NULL CHECK (length(name) <= 300),
  kind            text NOT NULL CHECK (kind IN ('internal', 'server', 'client', 'producer', 'consumer')),
  service         text NOT NULL CHECK (length(service) <= 64),
  start_ts        timestamptz NOT NULL,
  duration_ms     double precision NOT NULL CHECK (duration_ms >= 0),
  status          text NOT NULL CHECK (status IN ('unset', 'ok', 'error')),
  status_message  text CHECK (status_message IS NULL OR length(status_message) <= 200),
  attributes      jsonb NOT NULL DEFAULT '{}'::jsonb,
  tenant_id       uuid
);
CREATE INDEX IF NOT EXISTS telemetry_spans_start_idx ON telemetry_spans (start_ts);
CREATE INDEX IF NOT EXISTS telemetry_spans_trace_idx ON telemetry_spans (trace_id, start_ts);
