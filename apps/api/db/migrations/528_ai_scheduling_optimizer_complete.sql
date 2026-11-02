-- 528_ai_scheduling_optimizer_complete.sql — BUILD_PLAN Phase 7 (ai_scheduling_optimizer → complete).
--
-- Migration 345 created fourteen optimizer tables with no foreign keys, no status CHECKs and a `version` column nobody
-- incremented; nine of them were never written. This migration makes them the real store the optimizer now uses:
--   1. Status CHECKs on every workflow table. The recommendation CHECK keeps 'generated' (the state machine's entry);
--      rows left in 'generated' by the old code are moved to 'review_required' (the state they should have been in —
--      every accept/reject from them answered 409).
--   2. Foreign keys between the optimizer's own tables, added NOT VALID: enforced for every new row, no scan of history.
--   3. Columns the complete workflow needs: the run's date / technician / metrics / counts, the recommendation's
--      violations, simulation, server-derived "touches a confirmed appointment", apply attempt (the retry key is versioned
--      by it), explanation source, decider, automation flag; the customer proposal's customer, original slot, notify /
--      decision bookkeeping and version; decided-by + version on the duration / staffing / availability recommendations.
--   4. Two inputs the hard-constraint gate had no source for: technician time off and a manual "do not move" lock on an
--      appointment. Per-service setup / cleanup / processing minutes and group size live in service_scheduling_profiles.
--   5. One live customer proposal per recommendation; one rule version number per settings scope.
-- Every table stays tenant-scoped (tenant_id NOT NULL). Appointments are still never copied — referenced by id only.

-- ── 1. status CHECKs (pre-flight first) ─────────────────────────────────────────────────────────────────────────────
UPDATE schedule_optimization_recommendations SET status = 'review_required', updated_at = now() WHERE status = 'generated';

ALTER TABLE schedule_optimization_runs DROP CONSTRAINT IF EXISTS chk_sched_runs_status;
ALTER TABLE schedule_optimization_runs ADD CONSTRAINT chk_sched_runs_status CHECK (status IN ('started','completed','failed')) NOT VALID;
ALTER TABLE schedule_optimization_runs DROP CONSTRAINT IF EXISTS chk_sched_runs_scope;
ALTER TABLE schedule_optimization_runs ADD CONSTRAINT chk_sched_runs_scope CHECK (scope IN ('single_appointment','technician_day','branch_day','branch_week','tenant_multi_branch')) NOT VALID;

ALTER TABLE schedule_optimization_recommendations DROP CONSTRAINT IF EXISTS chk_sched_recs_status;
ALTER TABLE schedule_optimization_recommendations ADD CONSTRAINT chk_sched_recs_status CHECK (status IN (
  'generated','review_required','review_in_progress','accepted','partially_accepted','rejected','needs_revision',
  'customer_approval_required','customer_approved','application_pending','applied','application_failed',
  'expired','superseded','rolled_back')) NOT VALID;
ALTER TABLE schedule_optimization_recommendations DROP CONSTRAINT IF EXISTS chk_sched_recs_quality;
ALTER TABLE schedule_optimization_recommendations ADD CONSTRAINT chk_sched_recs_quality CHECK (data_quality IN ('good','partial','insufficient')) NOT VALID;

ALTER TABLE schedule_change_proposals DROP CONSTRAINT IF EXISTS chk_sched_proposals_status;
ALTER TABLE schedule_change_proposals ADD CONSTRAINT chk_sched_proposals_status CHECK (status IN ('proposed','customer_notified','customer_approved','customer_rejected','expired','applied','withdrawn')) NOT VALID;

ALTER TABLE schedule_change_applications DROP CONSTRAINT IF EXISTS chk_sched_apply_status;
ALTER TABLE schedule_change_applications ADD CONSTRAINT chk_sched_apply_status CHECK (status IN ('pending','applied','failed','stale','rolled_back')) NOT VALID;

ALTER TABLE service_duration_recommendations DROP CONSTRAINT IF EXISTS chk_dur_recs_status;
ALTER TABLE service_duration_recommendations ADD CONSTRAINT chk_dur_recs_status CHECK (status IN ('review_required','approved','rejected','superseded')) NOT VALID;
ALTER TABLE staffing_coverage_recommendations DROP CONSTRAINT IF EXISTS chk_staffing_recs_status;
ALTER TABLE staffing_coverage_recommendations ADD CONSTRAINT chk_staffing_recs_status CHECK (status IN ('review_required','approved','rejected','superseded')) NOT VALID;
ALTER TABLE appointment_availability_recommendations DROP CONSTRAINT IF EXISTS chk_avail_recs_status;
ALTER TABLE appointment_availability_recommendations ADD CONSTRAINT chk_avail_recs_status CHECK (status IN ('review_required','approved','rejected','superseded')) NOT VALID;
ALTER TABLE appointment_availability_recommendations DROP CONSTRAINT IF EXISTS chk_avail_recs_direction;
ALTER TABLE appointment_availability_recommendations ADD CONSTRAINT chk_avail_recs_direction CHECK (direction IN ('open','close')) NOT VALID;

ALTER TABLE schedule_conflicts DROP CONSTRAINT IF EXISTS chk_sched_conflicts_severity;
ALTER TABLE schedule_conflicts ADD CONSTRAINT chk_sched_conflicts_severity CHECK (severity IN ('info','warning','critical')) NOT VALID;

ALTER TABLE tenant_scheduling_ai_settings DROP CONSTRAINT IF EXISTS chk_sched_settings_level;
ALTER TABLE tenant_scheduling_ai_settings ADD CONSTRAINT chk_sched_settings_level CHECK ((level = 'tenant' AND branch_id IS NULL) OR (level = 'branch' AND branch_id IS NOT NULL)) NOT VALID;

-- ── 3. columns ──────────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE schedule_optimization_runs
  ADD COLUMN IF NOT EXISTS run_date DATE,
  ADD COLUMN IF NOT EXISTS technician_id UUID,
  ADD COLUMN IF NOT EXISTS run_trigger TEXT NOT NULL DEFAULT 'manual',          -- manual | job | automation
  ADD COLUMN IF NOT EXISTS metrics JSONB,
  ADD COLUMN IF NOT EXISTS gap_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS conflict_count INT NOT NULL DEFAULT 0;
ALTER TABLE schedule_optimization_runs DROP CONSTRAINT IF EXISTS chk_sched_runs_trigger;
ALTER TABLE schedule_optimization_runs ADD CONSTRAINT chk_sched_runs_trigger CHECK (run_trigger IN ('manual','job','automation')) NOT VALID;

ALTER TABLE schedule_optimization_recommendations
  ADD COLUMN IF NOT EXISTS violations JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS simulation JSONB,
  ADD COLUMN IF NOT EXISTS touches_confirmed_appointment BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS apply_attempt INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS explanation_source TEXT,                         -- llm | template
  ADD COLUMN IF NOT EXISTS decided_by_user_id UUID,
  ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS applied_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS automated BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE schedule_optimization_recommendations DROP CONSTRAINT IF EXISTS chk_sched_recs_expl_source;
ALTER TABLE schedule_optimization_recommendations ADD CONSTRAINT chk_sched_recs_expl_source CHECK (explanation_source IS NULL OR explanation_source IN ('llm','template')) NOT VALID;

ALTER TABLE schedule_change_proposals
  ADD COLUMN IF NOT EXISTS customer_id UUID,
  ADD COLUMN IF NOT EXISTS original_start TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS original_technician_id UUID,
  ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS notification_attempts INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS decision_channel TEXT,                           -- customer_web | staff_recorded | sms_reply
  ADD COLUMN IF NOT EXISTS decided_by_user_id UUID,                         -- set only when staff record a customer's decision
  ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE schedule_change_applications
  ADD COLUMN IF NOT EXISTS attempt INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS rolled_back_at TIMESTAMPTZ;

ALTER TABLE schedule_gaps ADD COLUMN IF NOT EXISTS run_id UUID;
ALTER TABLE schedule_conflicts
  ADD COLUMN IF NOT EXISTS run_id UUID,
  ADD COLUMN IF NOT EXISTS technician_id UUID,
  ADD COLUMN IF NOT EXISTS conflict_date DATE;

ALTER TABLE service_duration_recommendations
  ADD COLUMN IF NOT EXISTS sample_size INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS decided_by_user_id UUID, ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1, ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE staffing_coverage_recommendations
  ADD COLUMN IF NOT EXISTS run_id UUID,
  ADD COLUMN IF NOT EXISTS decided_by_user_id UUID, ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1, ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE appointment_availability_recommendations
  ADD COLUMN IF NOT EXISTS run_id UUID,
  ADD COLUMN IF NOT EXISTS decided_by_user_id UUID, ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1, ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- ── 2. foreign keys between the optimizer's own tables (NOT VALID: new rows only) ────────────────────────────────────
ALTER TABLE schedule_optimization_recommendations DROP CONSTRAINT IF EXISTS fk_sched_recs_run;
ALTER TABLE schedule_optimization_recommendations ADD CONSTRAINT fk_sched_recs_run FOREIGN KEY (run_id) REFERENCES schedule_optimization_runs(id) ON DELETE SET NULL NOT VALID;
ALTER TABLE schedule_recommendation_impacts DROP CONSTRAINT IF EXISTS fk_sched_impacts_rec;
ALTER TABLE schedule_recommendation_impacts ADD CONSTRAINT fk_sched_impacts_rec FOREIGN KEY (recommendation_id) REFERENCES schedule_optimization_recommendations(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE schedule_recommendation_decisions DROP CONSTRAINT IF EXISTS fk_sched_decisions_rec;
ALTER TABLE schedule_recommendation_decisions ADD CONSTRAINT fk_sched_decisions_rec FOREIGN KEY (recommendation_id) REFERENCES schedule_optimization_recommendations(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE schedule_change_proposals DROP CONSTRAINT IF EXISTS fk_sched_proposals_rec;
ALTER TABLE schedule_change_proposals ADD CONSTRAINT fk_sched_proposals_rec FOREIGN KEY (recommendation_id) REFERENCES schedule_optimization_recommendations(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE schedule_change_applications DROP CONSTRAINT IF EXISTS fk_sched_apply_rec;
ALTER TABLE schedule_change_applications ADD CONSTRAINT fk_sched_apply_rec FOREIGN KEY (recommendation_id) REFERENCES schedule_optimization_recommendations(id) ON DELETE SET NULL NOT VALID;
ALTER TABLE schedule_gaps DROP CONSTRAINT IF EXISTS fk_sched_gaps_run;
ALTER TABLE schedule_gaps ADD CONSTRAINT fk_sched_gaps_run FOREIGN KEY (run_id) REFERENCES schedule_optimization_runs(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE schedule_conflicts DROP CONSTRAINT IF EXISTS fk_sched_conflicts_run;
ALTER TABLE schedule_conflicts ADD CONSTRAINT fk_sched_conflicts_run FOREIGN KEY (run_id) REFERENCES schedule_optimization_runs(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE staffing_coverage_recommendations DROP CONSTRAINT IF EXISTS fk_staffing_recs_run;
ALTER TABLE staffing_coverage_recommendations ADD CONSTRAINT fk_staffing_recs_run FOREIGN KEY (run_id) REFERENCES schedule_optimization_runs(id) ON DELETE SET NULL NOT VALID;
ALTER TABLE appointment_availability_recommendations DROP CONSTRAINT IF EXISTS fk_avail_recs_run;
ALTER TABLE appointment_availability_recommendations ADD CONSTRAINT fk_avail_recs_run FOREIGN KEY (run_id) REFERENCES schedule_optimization_runs(id) ON DELETE SET NULL NOT VALID;

-- ── 4. inputs the hard-constraint gate had no source for ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS technician_time_off (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL,
  branch_id          UUID,                                   -- NULL = every location the technician works
  technician_id      UUID NOT NULL,
  starts_at          TIMESTAMPTZ NOT NULL,
  ends_at            TIMESTAMPTZ NOT NULL,
  status             TEXT NOT NULL DEFAULT 'approved',
  reason             TEXT,
  created_by_user_id UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_time_off_range CHECK (ends_at > starts_at),
  CONSTRAINT chk_time_off_status CHECK (status IN ('approved','pending','cancelled'))
);
CREATE INDEX IF NOT EXISTS idx_time_off_tech ON technician_time_off (tenant_id, technician_id, starts_at);

CREATE TABLE IF NOT EXISTS appointment_schedule_locks (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL,
  branch_id          UUID,
  appointment_id     UUID NOT NULL,
  reason             TEXT,
  locked_by_user_id  UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_appt_schedule_lock ON appointment_schedule_locks (tenant_id, appointment_id);

CREATE TABLE IF NOT EXISTS service_scheduling_profiles (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL,
  service_id         UUID NOT NULL,
  setup_min          INT NOT NULL DEFAULT 0,
  cleanup_min        INT NOT NULL DEFAULT 0,
  max_group_size     INT,
  updated_by_user_id UUID,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_ssp_minutes CHECK (setup_min BETWEEN 0 AND 120 AND cleanup_min BETWEEN 0 AND 120),
  CONSTRAINT chk_ssp_group CHECK (max_group_size IS NULL OR max_group_size BETWEEN 1 AND 50)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ssp_service ON service_scheduling_profiles (tenant_id, service_id);

-- ── 5. uniqueness + indexes ─────────────────────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_sched_proposal_live ON schedule_change_proposals (tenant_id, recommendation_id)
  WHERE status IN ('proposed','customer_notified');
CREATE INDEX IF NOT EXISTS idx_sched_proposals_customer ON schedule_change_proposals (tenant_id, customer_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sched_rule_version ON scheduling_rule_versions (tenant_id, level, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'), version);
CREATE INDEX IF NOT EXISTS idx_sched_recs_run ON schedule_optimization_recommendations (tenant_id, run_id);
CREATE INDEX IF NOT EXISTS idx_sched_gaps_run ON schedule_gaps (tenant_id, run_id);
CREATE INDEX IF NOT EXISTS idx_sched_conflicts_run ON schedule_conflicts (tenant_id, run_id);
CREATE INDEX IF NOT EXISTS idx_dur_recs_status ON service_duration_recommendations (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_staffing_recs_status ON staffing_coverage_recommendations (tenant_id, branch_id, status, date);
CREATE INDEX IF NOT EXISTS idx_avail_recs_status ON appointment_availability_recommendations (tenant_id, branch_id, status, date);
CREATE INDEX IF NOT EXISTS idx_sched_apply_rec ON schedule_change_applications (tenant_id, recommendation_id);
