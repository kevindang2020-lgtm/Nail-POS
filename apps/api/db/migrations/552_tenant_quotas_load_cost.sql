-- 552_tenant_quotas_load_cost.sql — BUILD_PLAN Phase 11 (Constitution 4 §113/§160 quotas, §35 noisy neighbour,
-- §96/§171 cost monitoring).
--
-- QUOTAS. What already exists stays the source of truth and is only READ by QuotaService.limitFor:
--   • AI budget            → ai_budgets (tenant, '*', daily|monthly)              (437)
--   • SMS volume           → the tenant's SMS package cycle allowance + hard limit (427)
-- What was missing is added here, as a plan default plus a per-tenant override (override wins; NULL = inherit):
--   • api_requests_per_min → the per-tenant API limiter's budget (env RATE_LIMIT_MAX_PER_TENANT is the platform default)
--   • jobs_in_flight       → the durable jobs queue's per-tenant running cap (env JOBS_PER_TENANT_CAP is the default)
--   • storage_bytes        → enforced on upload against tenant_storage_usage (NULL everywhere = unlimited)
CREATE TABLE IF NOT EXISTS plan_quota_defaults (
  plan_id               uuid PRIMARY KEY REFERENCES subscription_plans (id) ON DELETE CASCADE,
  api_requests_per_min  integer CHECK (api_requests_per_min IS NULL OR api_requests_per_min BETWEEN 1 AND 1000000),
  jobs_in_flight        integer CHECK (jobs_in_flight IS NULL OR jobs_in_flight BETWEEN 1 AND 50),
  storage_bytes         bigint  CHECK (storage_bytes IS NULL OR storage_bytes >= 0),
  reason                text CHECK (reason IS NULL OR length(reason) <= 500),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            uuid
);

CREATE TABLE IF NOT EXISTS tenant_quotas (
  tenant_id             uuid PRIMARY KEY REFERENCES tenants (id) ON DELETE CASCADE,
  api_requests_per_min  integer CHECK (api_requests_per_min IS NULL OR api_requests_per_min BETWEEN 1 AND 1000000),
  jobs_in_flight        integer CHECK (jobs_in_flight IS NULL OR jobs_in_flight BETWEEN 1 AND 50),
  storage_bytes         bigint  CHECK (storage_bytes IS NULL OR storage_bytes >= 0),
  reason                text CHECK (reason IS NULL OR length(reason) <= 500),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            uuid
);

-- Bytes a tenant has uploaded through the API (multipart uploads that succeeded). Reserved atomically BEFORE the upload
-- is processed (a conditional UPDATE, so two concurrent uploads cannot both slip under the quota) and released when the
-- request fails. Deletions do not decrement it (the upload paths have no single delete hook); the media lifecycle job is
-- the place to recount it from the object store.
CREATE TABLE IF NOT EXISTS tenant_storage_usage (
  tenant_id   uuid PRIMARY KEY REFERENCES tenants (id) ON DELETE CASCADE,
  bytes_used  bigint NOT NULL DEFAULT 0 CHECK (bytes_used >= 0),
  uploads     bigint NOT NULL DEFAULT 0 CHECK (uploads >= 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid
);

-- NOISY NEIGHBOUR. Per tenant per minute: requests, request time and DB statement time, flushed additively by every API
-- process (HttpMetricsInterceptor) — the per-route table platform_request_metrics_minute has no tenant dimension.
-- Bounded per process per minute (MAX_TENANTS_PER_MINUTE; the rest fold into no row and are counted in a metric).
CREATE TABLE IF NOT EXISTS tenant_load_minute (
  bucket_minute  timestamptz NOT NULL,
  tenant_id      uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  request_count  integer NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  sum_ms         bigint  NOT NULL DEFAULT 0 CHECK (sum_ms >= 0),
  db_ms          bigint  NOT NULL DEFAULT 0 CHECK (db_ms >= 0),
  db_queries     integer NOT NULL DEFAULT 0 CHECK (db_queries >= 0),
  PRIMARY KEY (bucket_minute, tenant_id)
);
CREATE INDEX IF NOT EXISTS ix_tenant_load_minute_tenant ON tenant_load_minute (tenant_id, bucket_minute DESC);

-- COST (§96/§171) needs no table: the daily per-tenant, per-provider quantities are read straight from the existing usage
-- ledgers (sms_usage_records, sms_delivery_logs, ai_usage_logs, jobs, tenant_storage_usage) by CostService
-- (apps/api/src/observability/capacity-ops.ts). Deliberately NOT a view: a view runs with its owner's rights and would
-- bypass the row-level security of migration 544 for whoever can select from it. Unit prices live in platform_settings
-- ('cost.unit_price.*', default 0 = unknown); nothing here invents a provider price.
