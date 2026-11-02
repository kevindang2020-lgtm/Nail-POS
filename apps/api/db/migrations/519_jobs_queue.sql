-- 519_jobs_queue.sql — Phase 2 of BUILD_PLAN_2026-10-06 (Constitution 4 §28–36): ONE durable job queue.
--
-- Until now background work was either an interval scheduler or one of ~12 per-feature job tables, each with its own
-- retry rules (or none), and `ai_jobs` (437) that nothing consumed. This is the queue every module enqueues to and the
-- worker process drains: priority (0 = most urgent … 3), a job class that maps onto WORKER_JOB_CLASSES, retries with
-- exponential backoff and jitter, a lease so a crashed worker's job is picked up again, a dead state an operator can
-- see and retry, an idempotency key so the same work is never enqueued twice, and the tenant on every job so one busy
-- salon cannot take every worker (per-tenant concurrency cap at claim time).
CREATE TABLE IF NOT EXISTS jobs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_class        text NOT NULL CHECK (job_class IN ('critical', 'standard', 'ai', 'report', 'import', 'reconciliation')),
  job_type         text NOT NULL CHECK (job_type ~ '^[a-z][a-z0-9_.]*$'),
  tenant_id        uuid REFERENCES tenants(id) ON DELETE CASCADE,
  priority         smallint NOT NULL DEFAULT 2 CHECK (priority BETWEEN 0 AND 3),
  payload          jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key  text,
  status           text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'dead', 'canceled')),
  attempts         integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts     integer NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 25),
  run_after        timestamptz NOT NULL DEFAULT now(),
  lease_owner      text,
  lease_until      timestamptz,
  last_error       text,
  result           jsonb,
  correlation_id   text,
  created_by       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  started_at       timestamptz,
  finished_at      timestamptz,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT jobs_lease_pair CHECK ((lease_owner IS NULL) = (lease_until IS NULL)),
  CONSTRAINT jobs_running_has_lease CHECK (status <> 'running' OR lease_owner IS NOT NULL)
);
-- Claim order: the next due job of a class, most urgent first.
CREATE INDEX IF NOT EXISTS ix_jobs_claim ON jobs (job_class, priority, run_after) WHERE status = 'queued';
-- Lease reaping and per-tenant concurrency read running jobs only.
CREATE INDEX IF NOT EXISTS ix_jobs_running ON jobs (job_class, tenant_id, lease_until) WHERE status = 'running';
-- Operator views: a tenant's jobs, dead jobs.
CREATE INDEX IF NOT EXISTS ix_jobs_tenant ON jobs (tenant_id, created_at DESC) WHERE tenant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_jobs_dead ON jobs (finished_at DESC) WHERE status = 'dead';
-- The same work is enqueued once: (type, key) is unique while the job is not finished-and-forgotten.
CREATE UNIQUE INDEX IF NOT EXISTS uq_jobs_idempotency ON jobs (job_type, idempotency_key) WHERE idempotency_key IS NOT NULL;
COMMENT ON TABLE jobs IS 'Platform-global queue (tenant_id names the salon a job works for): the one durable job queue (migration 519).';
