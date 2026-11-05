-- 179_automation_rules.sql — the conditional-workflow engine store for Super Admin › AI & Automation › Automation Rules.
-- Rules + immutable published versions + executions (idempotent by unique key) + tenant exceptions + failure/retry queue.
-- Distinct from Smart Reminders (generation_runs/workflow_runs). Money-free; actions dispatch through existing services.
-- All scoped by tenant_id (NULL tenant_id = platform-wide rule spanning all tenants).

CREATE TABLE IF NOT EXISTS automation_rules (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_reference    TEXT NOT NULL,
  name              TEXT NOT NULL,
  description       TEXT,
  rule_type         TEXT NOT NULL DEFAULT 'event_based',   -- event_based|time_based|threshold_based|manual|other
  trigger_id        TEXT NOT NULL,                          -- from the structured trigger catalog
  trigger_category  TEXT NOT NULL DEFAULT 'other',
  status            TEXT NOT NULL DEFAULT 'draft',          -- draft|pending_review|approved|active|paused|disabled|error|retired|archived
  scope_kind        TEXT NOT NULL DEFAULT 'all_tenants',    -- all_tenants|tenant|branch
  tenant_id         UUID,                                   -- NULL = platform-wide
  branch_id         UUID,
  current_version   INTEGER NOT NULL DEFAULT 1,
  next_evaluation_at TIMESTAMPTZ,                            -- for time/threshold rules (Upcoming Rule Evaluations)
  owner_id          UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_auto_rules_status ON automation_rules (status);
CREATE INDEX IF NOT EXISTS ix_auto_rules_tenant ON automation_rules (tenant_id, status);
CREATE INDEX IF NOT EXISTS ix_auto_rules_type ON automation_rules (rule_type);
CREATE INDEX IF NOT EXISTS ix_auto_rules_trigcat ON automation_rules (trigger_category);
CREATE INDEX IF NOT EXISTS ix_auto_rules_next_eval ON automation_rules (next_evaluation_at) WHERE next_evaluation_at IS NOT NULL;

-- immutable published versions: editing an active rule creates a new version; published rows are never overwritten
CREATE TABLE IF NOT EXISTS automation_rule_versions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id            UUID NOT NULL REFERENCES automation_rules(id) ON DELETE CASCADE,
  version_number     INTEGER NOT NULL,
  trigger_definition JSONB NOT NULL DEFAULT '{}'::jsonb,
  condition_definition JSONB NOT NULL DEFAULT '{}'::jsonb,
  action_definitions JSONB NOT NULL DEFAULT '[]'::jsonb,
  scope_definition   JSONB NOT NULL DEFAULT '{}'::jsonb,
  retry_policy       JSONB NOT NULL DEFAULT '{}'::jsonb,
  timeout_ms         INTEGER NOT NULL DEFAULT 30000,
  cooldown_seconds   INTEGER NOT NULL DEFAULT 0,
  execution_limit    INTEGER,
  effective_from     TIMESTAMPTZ,
  effective_to       TIMESTAMPTZ,
  change_notes       TEXT,
  created_by         UUID,
  approved_by        UUID,
  published_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (rule_id, version_number)
);

CREATE TABLE IF NOT EXISTS automation_executions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_reference TEXT,
  rule_id            UUID NOT NULL REFERENCES automation_rules(id) ON DELETE CASCADE,
  rule_version_id    UUID REFERENCES automation_rule_versions(id),
  trigger_event_id   TEXT,
  tenant_id          UUID,
  branch_id          UUID,
  status             TEXT NOT NULL DEFAULT 'success',       -- success|partial|failed|skipped|suppressed|timed_out|cancelled
  triggered_by       TEXT NOT NULL DEFAULT 'system',        -- system|scheduler|webhook|super_admin|tenant_admin|retry_worker|api_event
  started_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at       TIMESTAMPTZ,
  duration_ms        INTEGER,
  idempotency_key    TEXT NOT NULL,
  correlation_id     TEXT,
  causation_id       TEXT,
  retry_count        INTEGER NOT NULL DEFAULT 0,
  failure_category   TEXT,                                  -- temporary|permanent|safety
  failure_message    TEXT,
  action_count       INTEGER NOT NULL DEFAULT 0,
  notifications_sent INTEGER NOT NULL DEFAULT 0,
  is_test            BOOLEAN NOT NULL DEFAULT false,        -- test/dry-run executions excluded from production KPIs
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (idempotency_key)
);
CREATE INDEX IF NOT EXISTS ix_auto_exec_rule ON automation_executions (rule_id, started_at DESC);
CREATE INDEX IF NOT EXISTS ix_auto_exec_tenant ON automation_executions (tenant_id, started_at DESC);
CREATE INDEX IF NOT EXISTS ix_auto_exec_status ON automation_executions (status, started_at DESC);
CREATE INDEX IF NOT EXISTS ix_auto_exec_started ON automation_executions (started_at DESC);

CREATE TABLE IF NOT EXISTS automation_exceptions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id        UUID NOT NULL REFERENCES automation_rules(id) ON DELETE CASCADE,
  tenant_id      UUID NOT NULL,
  branch_id      UUID,
  exception_type TEXT NOT NULL,
  original_value TEXT,
  override_value TEXT,
  notes          TEXT,
  reason         TEXT,
  status         TEXT NOT NULL DEFAULT 'active',            -- active|expired|revoked|pending_review
  effective_date TIMESTAMPTZ,
  expiration_date TIMESTAMPTZ,
  created_by     UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_auto_exc_tenant ON automation_exceptions (tenant_id, status);
CREATE INDEX IF NOT EXISTS ix_auto_exc_rule ON automation_exceptions (rule_id, status);

CREATE TABLE IF NOT EXISTS automation_failures (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id     UUID REFERENCES automation_executions(id) ON DELETE CASCADE,
  rule_id          UUID NOT NULL REFERENCES automation_rules(id) ON DELETE CASCADE,
  tenant_id        UUID,
  failure_reason   TEXT NOT NULL,
  failure_category TEXT NOT NULL DEFAULT 'temporary',       -- temporary|permanent|safety
  severity         TEXT NOT NULL DEFAULT 'medium',          -- low|medium|high
  status           TEXT NOT NULL DEFAULT 'waiting',         -- waiting|retrying|resolved|abandoned
  retry_count      INTEGER NOT NULL DEFAULT 0,
  last_attempt_at  TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_auto_fail_status ON automation_failures (status, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_auto_fail_tenant ON automation_failures (tenant_id, status);
