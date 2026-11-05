-- 324_ai_scheduling_optimizer.sql — AI Scheduling Optimizer data model. Every table is tenant-scoped (tenant_id NOT NULL)
-- and branch-aware. This module NEVER stores a second copy of appointments/holds/shifts — it references the existing
-- appointments/booking_holds/technician_* tables by id and stores only optimizer artifacts (runs, recommendations,
-- impacts, decisions, proposals, stats, settings). Recommendations are advisory; application happens through the existing
-- booking service. Automation is off by default (see tenant_scheduling_ai_settings.config).

-- ── optimization runs ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS schedule_optimization_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  branch_id       UUID,
  scope           TEXT NOT NULL,                         -- single_appointment|technician_day|branch_day|branch_week|tenant_multi_branch
  status          TEXT NOT NULL DEFAULT 'started',       -- started|completed|failed
  requested_by_user_id UUID,
  idempotency_key TEXT,
  forecast_version TEXT,
  rule_version    TEXT,
  engine_version  TEXT,
  config_version  INT,
  correlation_id  TEXT,
  recommendation_count INT NOT NULL DEFAULT 0,
  latency_ms      INT,
  error_code      TEXT,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sched_runs_idem ON schedule_optimization_runs (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sched_runs_tenant ON schedule_optimization_runs (tenant_id, branch_id, started_at DESC);

-- ── recommendations + impacts + decisions ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS schedule_optimization_recommendations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  branch_id       UUID,
  run_id          UUID,
  type            TEXT NOT NULL,                         -- move_appointment|change_technician|...|preserve_schedule
  status          TEXT NOT NULL DEFAULT 'generated',     -- generated|review_required|review_in_progress|accepted|partially_accepted|rejected|customer_approval_required|customer_approved|application_pending|applied|application_failed|expired|superseded|rolled_back|needs_revision
  current_state   JSONB,
  proposed_state  JSONB,
  affected_appointment_ids JSONB NOT NULL DEFAULT '[]',
  affected_technician_ids  JSONB NOT NULL DEFAULT '[]',
  hard_constraints_checked BOOLEAN NOT NULL DEFAULT false,
  soft_objectives_improved JSONB NOT NULL DEFAULT '[]',
  expected_benefit JSONB NOT NULL DEFAULT '[]',
  possible_downside JSONB NOT NULL DEFAULT '[]',
  confidence      NUMERIC(4,3) DEFAULT 0,
  data_quality    TEXT NOT NULL DEFAULT 'good',
  requires_human_review BOOLEAN NOT NULL DEFAULT true,
  requires_customer_approval BOOLEAN NOT NULL DEFAULT false,
  forecast_version TEXT, rule_version TEXT, engine_version TEXT, config_version INT,
  version         INT NOT NULL DEFAULT 1,
  expires_at      TIMESTAMPTZ,
  explanation     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sched_recs_tenant ON schedule_optimization_recommendations (tenant_id, branch_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sched_recs_expiry ON schedule_optimization_recommendations (tenant_id, expires_at);

CREATE TABLE IF NOT EXISTS schedule_recommendation_impacts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  recommendation_id UUID NOT NULL,
  before_metrics  JSONB, after_metrics JSONB, deltas JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sched_impacts_rec ON schedule_recommendation_impacts (tenant_id, recommendation_id);

CREATE TABLE IF NOT EXISTS schedule_recommendation_decisions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  recommendation_id UUID NOT NULL,
  action          TEXT NOT NULL,                         -- accept|partial_accept|reject|edit|dismiss|feedback
  actor_user_id   UUID,
  reason          TEXT,
  before_snapshot JSONB, after_snapshot JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sched_decisions_rec ON schedule_recommendation_decisions (tenant_id, recommendation_id);

-- ── customer change proposals + applications ──────────────────────────────────
CREATE TABLE IF NOT EXISTS schedule_change_proposals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  branch_id       UUID,
  recommendation_id UUID,
  appointment_id  UUID NOT NULL,                         -- references existing appointments.id
  proposed_start  TIMESTAMPTZ, proposed_end TIMESTAMPTZ, proposed_technician_id UUID,
  status          TEXT NOT NULL DEFAULT 'proposed',      -- proposed|customer_notified|customer_approved|customer_rejected|expired|applied
  original_preserved BOOLEAN NOT NULL DEFAULT true,
  expires_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sched_proposals ON schedule_change_proposals (tenant_id, appointment_id, status);

CREATE TABLE IF NOT EXISTS schedule_change_applications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  recommendation_id UUID,
  appointment_id  UUID,
  idempotency_key TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',       -- pending|applied|failed|rolled_back
  applied_via     TEXT,                                  -- booking_service.reschedule|assign_technician|open_slot|...
  schedule_version INT,                                  -- optimistic-lock version checked at apply
  external_ref    TEXT,
  error_code      TEXT,
  applied_by_user_id UUID,
  applied_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sched_apply_idem ON schedule_change_applications (idempotency_key);

-- ── duration stats / recs, staffing / availability recs, conflicts, gaps ──────
CREATE TABLE IF NOT EXISTS service_duration_statistics (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL, branch_id UUID, service_id UUID NOT NULL, technician_id UUID,
  sample_size     INT NOT NULL DEFAULT 0,
  median_min      INT, p25_min INT, p75_min INT, p90_min INT, trimmed_mean_min INT, stddev_min INT,
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dur_stats ON service_duration_statistics (tenant_id, branch_id, service_id);

CREATE TABLE IF NOT EXISTS service_duration_recommendations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL, branch_id UUID, service_id UUID NOT NULL, technician_id UUID,
  action          TEXT NOT NULL, current_min INT, suggested_min INT, reason TEXT, confidence NUMERIC(4,3),
  status          TEXT NOT NULL DEFAULT 'review_required', -- review_required|approved|rejected
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS staffing_coverage_recommendations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL, branch_id UUID, date DATE, time_range JSONB,
  state           TEXT NOT NULL, missing_minutes INT, missing_skills JSONB NOT NULL DEFAULT '[]',
  recommended_action TEXT, confidence NUMERIC(4,3), status TEXT NOT NULL DEFAULT 'review_required',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS appointment_availability_recommendations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL, branch_id UUID, date DATE, time_range JSONB, technician_id UUID, service_id UUID,
  direction       TEXT NOT NULL,                         -- open|close
  reason          TEXT, confidence NUMERIC(4,3), status TEXT NOT NULL DEFAULT 'review_required',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS schedule_conflicts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL, branch_id UUID,
  type            TEXT NOT NULL, severity TEXT NOT NULL, appointment_ids JSONB NOT NULL DEFAULT '[]',
  message         TEXT, resolved BOOLEAN NOT NULL DEFAULT false,
  detected_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sched_conflicts ON schedule_conflicts (tenant_id, branch_id, resolved, severity);

CREATE TABLE IF NOT EXISTS schedule_gaps (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL, branch_id UUID, technician_id UUID, date DATE,
  start_min       INT, end_min INT, duration_min INT, cause TEXT, services_that_fit JSONB NOT NULL DEFAULT '[]',
  confidence      NUMERIC(4,3), detected_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sched_gaps ON schedule_gaps (tenant_id, branch_id, date);

-- ── settings (tri-state) + rule versions ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenant_scheduling_ai_settings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  level           TEXT NOT NULL DEFAULT 'tenant',        -- tenant|branch
  branch_id       UUID,
  enabled         BOOLEAN,
  kill_switch     BOOLEAN,                               -- force-disables automation regardless of other settings
  config          JSONB,
  version         INT NOT NULL DEFAULT 1,
  updated_by_user_id UUID,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sched_settings_scope ON tenant_scheduling_ai_settings (tenant_id, level, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'));

CREATE TABLE IF NOT EXISTS scheduling_rule_versions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL, level TEXT NOT NULL, branch_id UUID,
  version         INT NOT NULL, enabled BOOLEAN, kill_switch BOOLEAN, config JSONB,
  changed_by_user_id UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sched_rule_versions ON scheduling_rule_versions (tenant_id, level, version DESC);
