-- 437_ai_jobs_budgets.sql — Constitution 10 §65–§70 (async AI jobs) and §99–§108 (budgets, rate limits, fair queue).
--
-- NOT a second outbox. Migration 433's event_outbox carries DOMAIN EVENTS between modules; these rows are UNITS OF
-- AI WORK with their own lifecycle (provider attempts, validation, human review) and their own scheduling rules
-- (priority classes, per-tenant fairness, budget). An event that needs AI creates an ai_job; the two stay separate.

CREATE TABLE IF NOT EXISTS ai_jobs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL,
  branch_id        UUID,
  module           TEXT NOT NULL,
  task_key         TEXT NOT NULL,                      -- must exist in the AI Task Registry (§9)
  status           TEXT NOT NULL DEFAULT 'QUEUED'
                   CHECK (status IN ('QUEUED','RUNNING','WAITING_PROVIDER','VALIDATING','REVIEW_REQUIRED','COMPLETED','FAILED','CANCELED','RETRYING')),  -- §68
  priority         SMALLINT NOT NULL DEFAULT 2 CHECK (priority BETWEEN 0 AND 4),  -- §104 P0..P4
  actor_user_id    UUID,
  -- §69 input_reference: a POINTER (ticket id, transcript id, upload id), never the payload. §60 prohibited data
  -- must not be able to sit in a queue row, and a job row is not a place to park customer text.
  input_reference  TEXT NOT NULL,
  input_meta       JSONB NOT NULL DEFAULT '{}'::jsonb,
  result_reference TEXT,
  error_code       TEXT,
  error_message    TEXT,
  attempts         SMALLINT NOT NULL DEFAULT 0,
  max_attempts     SMALLINT NOT NULL DEFAULT 3,
  idempotency_key  TEXT,
  run_after        TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_at       TIMESTAMPTZ,
  claimed_by       TEXT,
  started_at       TIMESTAMPTZ,
  finished_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- §103 the scheduler's index: due work, best priority first, oldest first. Partial so finished rows do not bloat it.
CREATE INDEX IF NOT EXISTS ix_ai_jobs_claimable ON ai_jobs (priority, run_after, created_at)
  WHERE status IN ('QUEUED','RETRYING');
CREATE INDEX IF NOT EXISTS ix_ai_jobs_tenant_status ON ai_jobs (tenant_id, status, created_at DESC);
-- §87: one job per (tenant, task, idempotency key).
CREATE UNIQUE INDEX IF NOT EXISTS ux_ai_jobs_idem ON ai_jobs (tenant_id, task_key, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- §70: attempts are SEPARATE rows. One job that failed over from openai to anthropic has two, each with its own
-- provider, model, error and cost — which is what makes failover analysis and cost accounting possible at all.
CREATE TABLE IF NOT EXISTS ai_job_attempts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id           UUID NOT NULL REFERENCES ai_jobs (id) ON DELETE CASCADE,
  attempt_no       SMALLINT NOT NULL CHECK (attempt_no >= 1),
  provider         TEXT,
  model            TEXT,
  prompt_key       TEXT,
  prompt_version   INTEGER,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at         TIMESTAMPTZ,
  result           TEXT CHECK (result IN ('SUCCESS','SCHEMA_INVALID','PROVIDER_ERROR','TIMEOUT','RATE_LIMITED','CANCELED')),
  error_code       TEXT,
  input_tokens     INTEGER NOT NULL DEFAULT 0,
  output_tokens    INTEGER NOT NULL DEFAULT 0,
  cost_micro_usd   BIGINT NOT NULL DEFAULT 0,
  UNIQUE (job_id, attempt_no)
);
CREATE INDEX IF NOT EXISTS ix_ai_job_attempts_job ON ai_job_attempts (job_id, attempt_no);

-- §99 budgets. A row per (tenant, scope, period). scope_key = '*' for the whole tenant or a module name (§99
-- "module budget"). limit_micro_usd <= 0 means no limit — the same convention tenant_usage_limits already uses.
CREATE TABLE IF NOT EXISTS ai_budgets (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  scope_key         TEXT NOT NULL DEFAULT '*',
  period            TEXT NOT NULL CHECK (period IN ('daily','monthly')),
  limit_micro_usd   BIGINT NOT NULL DEFAULT 0,
  -- §101: what happens AT the limit, per policy — never a surprise bill, never a silent stop.
  at_limit_behavior TEXT NOT NULL DEFAULT 'block_low_priority'
                    CHECK (at_limit_behavior IN ('block_low_priority','block_all','queue','downgrade_model')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, scope_key, period)
);

-- §100: threshold alerts, recorded once per (budget, period instance, threshold) so 80% does not alert hourly.
CREATE TABLE IF NOT EXISTS ai_budget_alerts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  scope_key     TEXT NOT NULL,
  period        TEXT NOT NULL,
  period_start  DATE NOT NULL,
  threshold     SMALLINT NOT NULL CHECK (threshold IN (50,80,90,100)),
  spent_micro_usd BIGINT NOT NULL,
  limit_micro_usd BIGINT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, scope_key, period, period_start, threshold)
);
CREATE INDEX IF NOT EXISTS ix_ai_budget_alerts_tenant ON ai_budget_alerts (tenant_id, created_at DESC);
