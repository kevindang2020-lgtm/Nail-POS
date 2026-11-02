-- 443_platform_request_metrics_minute.sql — Constitution 11 §36–37, §246, §395: API telemetry as per-minute
-- aggregates, not one row per request.
--
-- platform_request_metrics (migration ~330) grows by ONE ROW PER HTTP REQUEST. At 10,000 tenants that is the
-- largest table in the database, competing with checkout for I/O — exactly the "raw telemetry firehose in
-- PostgreSQL OLTP" the spec prohibits. It also cannot answer p95 without scanning every row in the window.
--
-- This table holds one row per (minute, method, route template, status class): counts plus a fixed latency
-- histogram (§364, API buckets in milliseconds here because they are stored, not exposed; the registry exposes
-- seconds). p50/p95/p99 are computed from the bucket counts. 1,440 minutes × ~600 routes × 4 classes is bounded
-- by construction — the interceptor also caps distinct routes per minute.
--
-- The old table is NOT dropped by this migration: existing rows remain readable until the retention window
-- passes and a later cleanup migration removes it. New writes stop with the code that ships alongside this.
CREATE TABLE IF NOT EXISTS platform_request_metrics_minute (
  bucket_minute  TIMESTAMPTZ NOT NULL,
  method         TEXT        NOT NULL,
  route          TEXT        NOT NULL,          -- route TEMPLATE, never a raw URL (§37)
  status_class   SMALLINT    NOT NULL,          -- 2, 3, 4, 5 (and 0 for unknown)
  count          INTEGER     NOT NULL DEFAULT 0,
  count_429      INTEGER     NOT NULL DEFAULT 0,
  sum_ms         BIGINT      NOT NULL DEFAULT 0,
  max_ms         INTEGER     NOT NULL DEFAULT 0,
  -- cumulative-free bucket counts, upper bounds in ms: 5,10,25,50,100,250,500,1000,2500,5000,10000,+Inf
  le_5 INTEGER NOT NULL DEFAULT 0, le_10 INTEGER NOT NULL DEFAULT 0, le_25 INTEGER NOT NULL DEFAULT 0,
  le_50 INTEGER NOT NULL DEFAULT 0, le_100 INTEGER NOT NULL DEFAULT 0, le_250 INTEGER NOT NULL DEFAULT 0,
  le_500 INTEGER NOT NULL DEFAULT 0, le_1000 INTEGER NOT NULL DEFAULT 0, le_2500 INTEGER NOT NULL DEFAULT 0,
  le_5000 INTEGER NOT NULL DEFAULT 0, le_10000 INTEGER NOT NULL DEFAULT 0, le_inf INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket_minute, method, route, status_class)
);
CREATE INDEX IF NOT EXISTS ix_prm_minute_time ON platform_request_metrics_minute (bucket_minute DESC);
