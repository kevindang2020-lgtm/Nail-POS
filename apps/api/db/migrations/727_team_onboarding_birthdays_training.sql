-- 727_team_onboarding_birthdays_training.sql — Team Management round 2 (Four-Module Completion Guide §10, 30 Oct 2026):
-- TM-06 all-role onboarding, TM-07 nightly data-accuracy checks, TM-08 optional birthdays, TM-09 training & certification.
-- EXPAND-ONLY and idempotent (CREATE ... IF NOT EXISTS, ADD COLUMN IF NOT EXISTS; one CHECK on team_data_alerts is WIDENED
-- to accept three new alert types — no row can fail it). No existing row is rewritten, no column dropped.
--
--   team_staff_profiles            one row per staff member (user and / or technician record): the job role chosen at
--                                  onboarding (receptionist / assistant / manager / stylist / nail_technician / a configured
--                                  custom role) and the OPTIONAL birthday — month + day only, never a year — with its privacy
--                                  preference (shown to colleagues or not). Feb 29 is valid (shown on Feb 28 in other years).
--   team_onboarding_requests       idempotency for Add Team Member: one row per (tenant, Idempotency-Key) with the request's
--                                  hash and the result — a retry returns the same staff member, never a second one.
--   team_training_courses          the salon's training catalog.
--   team_training_assignments      one staff member × one course: assigned → in_progress → completed → expired, or canceled.
--                                  Completion is NOT certification: verification lives on the certification record.
--   team_training_events           append-only history of every assignment change.
--   team_staff_certifications      certifications of staff WITHOUT a technician record (issuer, credential, optional expiry,
--                                  verification separate from training completion). A technician's certifications stay in
--                                  technician_certifications (migration 584) and are LINKED (team_training_assignments.
--                                  technician_certification_id), never copied.
--   team_data_nightly_runs         the nightly per-tenant data check: one row per tenant-local date (idempotent), attempts,
--                                  last error, the scan it produced, escalation.
--   team_data_alert_runs           + run_trigger ('manual' | 'nightly'), run_date.
--   team_data_alerts               + seen_count, last_run_id; alert types + ORPHANED_ASSIGNMENT, MISSING_BRANCH_ASSOCIATION,
--                                  DATA_CHECK_JOB_FAILED (the escalation of repeated nightly failures).
--
-- Recovery: every table / column is new; rolling the code back leaves them unread. Do not drop them (training history,
-- birthdays people entered and nightly run records would be lost) — forward-fix only.

CREATE TABLE IF NOT EXISTS team_staff_profiles (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL REFERENCES tenants(id),
  user_id                uuid,
  technician_id          uuid,
  job_role               text,
  job_role_label         text,
  birthday_month         smallint,
  birthday_day           smallint,
  birthday_visible_to_team boolean NOT NULL DEFAULT false,
  birthday_updated_at    timestamptz,
  birthday_updated_by    uuid,
  onboarded_by           uuid,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_tsp_subject CHECK (user_id IS NOT NULL OR technician_id IS NOT NULL),
  CONSTRAINT ck_tsp_job_role CHECK (job_role IS NULL OR job_role IN ('receptionist', 'assistant', 'manager', 'stylist', 'nail_technician', 'custom')),
  CONSTRAINT ck_tsp_birthday_pair CHECK ((birthday_month IS NULL) = (birthday_day IS NULL)),
  CONSTRAINT ck_tsp_birthday_valid CHECK (birthday_month IS NULL OR (birthday_month BETWEEN 1 AND 12 AND birthday_day BETWEEN 1 AND
    CASE WHEN birthday_month = 2 THEN 29 WHEN birthday_month IN (4, 6, 9, 11) THEN 30 ELSE 31 END)),
  CONSTRAINT ck_tsp_label_len CHECK (job_role_label IS NULL OR length(job_role_label) <= 80)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tsp_user ON team_staff_profiles (tenant_id, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_tsp_technician ON team_staff_profiles (tenant_id, technician_id) WHERE technician_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tsp_birthday ON team_staff_profiles (tenant_id, birthday_month, birthday_day) WHERE birthday_month IS NOT NULL;

CREATE TABLE IF NOT EXISTS team_onboarding_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  idempotency_key  text NOT NULL,
  request_hash     text NOT NULL,
  actor_user_id    uuid,
  user_id          uuid,
  job_role         text,
  status           text NOT NULL DEFAULT 'succeeded',
  result_json      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_tor_key UNIQUE (tenant_id, idempotency_key),
  CONSTRAINT ck_tor_key_len CHECK (length(idempotency_key) BETWEEN 8 AND 100),
  CONSTRAINT ck_tor_status CHECK (status IN ('succeeded'))
);

CREATE TABLE IF NOT EXISTS team_training_courses (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL REFERENCES tenants(id),
  name                   text NOT NULL,
  category               text,
  description            text,
  validity_months        integer,
  certification_name     text,           -- the certification this course prepares for (informational; never auto-verified)
  status                 text NOT NULL DEFAULT 'active',
  version                integer NOT NULL DEFAULT 1,
  created_by             uuid,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_ttc_tenant_id UNIQUE (tenant_id, id),
  CONSTRAINT ck_ttc_status CHECK (status IN ('active', 'archived')),
  CONSTRAINT ck_ttc_validity CHECK (validity_months IS NULL OR validity_months BETWEEN 1 AND 120),
  CONSTRAINT ck_ttc_lengths CHECK (length(name) BETWEEN 2 AND 120 AND (category IS NULL OR length(category) <= 60)
    AND (description IS NULL OR length(description) <= 1000) AND (certification_name IS NULL OR length(certification_name) <= 120))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ttc_name ON team_training_courses (tenant_id, lower(name)) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS team_training_assignments (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   uuid NOT NULL REFERENCES tenants(id),
  branch_id                   uuid,
  course_id                   uuid NOT NULL,
  user_id                     uuid,
  technician_id               uuid,
  status                      text NOT NULL DEFAULT 'assigned',
  due_date                    date,
  assigned_by                 uuid,
  assigned_at                 timestamptz NOT NULL DEFAULT now(),
  started_at                  timestamptz,
  completed_at                timestamptz,
  completed_on                date,
  expires_on                  date,
  expired_at                  timestamptz,
  canceled_at                 timestamptz,
  cancel_reason               text,
  completion_note             text,
  technician_certification_id uuid,      -- LINK to technician_certifications (584) — never a copy
  staff_certification_id      uuid,      -- LINK to team_staff_certifications
  version                     integer NOT NULL DEFAULT 1,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_tta_tenant_id UNIQUE (tenant_id, id),
  CONSTRAINT fk_tta_course FOREIGN KEY (tenant_id, course_id) REFERENCES team_training_courses (tenant_id, id),
  CONSTRAINT ck_tta_subject CHECK (user_id IS NOT NULL OR technician_id IS NOT NULL),
  CONSTRAINT ck_tta_status CHECK (status IN ('assigned', 'in_progress', 'completed', 'expired', 'canceled')),
  CONSTRAINT ck_tta_completed CHECK (status NOT IN ('completed', 'expired') OR completed_at IS NOT NULL),
  CONSTRAINT ck_tta_lengths CHECK ((cancel_reason IS NULL OR length(cancel_reason) <= 1000) AND (completion_note IS NULL OR length(completion_note) <= 1000)),
  CONSTRAINT ck_tta_version CHECK (version >= 1)
);
CREATE INDEX IF NOT EXISTS idx_tta_member ON team_training_assignments (tenant_id, user_id, technician_id, status);
CREATE INDEX IF NOT EXISTS idx_tta_expiry ON team_training_assignments (tenant_id, expires_on) WHERE status = 'completed' AND expires_on IS NOT NULL;
-- one OPEN assignment per person per course (a completed / expired / canceled one may be followed by a new one)
CREATE UNIQUE INDEX IF NOT EXISTS uq_tta_open ON team_training_assignments (tenant_id, course_id, coalesce(user_id, technician_id)) WHERE status IN ('assigned', 'in_progress');

CREATE TABLE IF NOT EXISTS team_training_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  assignment_id   uuid,
  course_id       uuid,
  event_type      text NOT NULL,
  from_status     text,
  to_status       text,
  actor_user_id   uuid,
  reason          text,
  metadata_json   jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_id      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_tte_type CHECK (event_type IN ('COURSE_CREATED', 'COURSE_ARCHIVED', 'ASSIGNED', 'STARTED', 'COMPLETED', 'EXPIRED', 'CANCELED',
    'CERTIFICATION_RECORDED', 'CERTIFICATION_VERIFIED', 'CERTIFICATION_REJECTED')),
  CONSTRAINT ck_tte_lengths CHECK ((reason IS NULL OR length(reason) <= 1000) AND (request_id IS NULL OR length(request_id) <= 100))
);
CREATE INDEX IF NOT EXISTS idx_tte_assignment ON team_training_events (tenant_id, assignment_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS team_staff_certifications (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenants(id),
  user_id              uuid NOT NULL,
  name                 text NOT NULL,
  issuer               text,
  credential_ref       text,
  issued_on            date,
  expires_on           date,
  verification_status  text NOT NULL DEFAULT 'UNVERIFIED',
  verified_by          uuid,
  verified_at          timestamptz,
  verification_note    text,
  created_by           uuid,
  version              integer NOT NULL DEFAULT 1,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_tsc_tenant_id UNIQUE (tenant_id, id),
  CONSTRAINT ck_tsc_status CHECK (verification_status IN ('UNVERIFIED', 'VERIFIED', 'REJECTED', 'REVOKED')),
  CONSTRAINT ck_tsc_dates CHECK (expires_on IS NULL OR issued_on IS NULL OR expires_on >= issued_on),
  CONSTRAINT ck_tsc_lengths CHECK (length(name) BETWEEN 2 AND 120 AND (issuer IS NULL OR length(issuer) <= 120)
    AND (credential_ref IS NULL OR length(credential_ref) <= 120) AND (verification_note IS NULL OR length(verification_note) <= 1000))
);
CREATE INDEX IF NOT EXISTS idx_tsc_user ON team_staff_certifications (tenant_id, user_id);

CREATE TABLE IF NOT EXISTS team_data_nightly_runs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  run_date         date NOT NULL,              -- the salon-local date the run is for
  status           text NOT NULL DEFAULT 'running',
  attempts         integer NOT NULL DEFAULT 0,
  job_id           uuid,
  alert_run_id     uuid,
  last_error       text,
  summary_json     jsonb NOT NULL DEFAULT '{}'::jsonb,
  escalated_at     timestamptz,
  started_at       timestamptz NOT NULL DEFAULT now(),
  finished_at      timestamptz,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_tdnr_day UNIQUE (tenant_id, run_date),
  CONSTRAINT ck_tdnr_status CHECK (status IN ('running', 'succeeded', 'failed')),
  CONSTRAINT ck_tdnr_error_len CHECK (last_error IS NULL OR length(last_error) <= 200)
);
CREATE INDEX IF NOT EXISTS idx_tdnr_recent ON team_data_nightly_runs (tenant_id, run_date DESC);

ALTER TABLE team_data_alert_runs ADD COLUMN IF NOT EXISTS run_trigger text NOT NULL DEFAULT 'manual';
ALTER TABLE team_data_alert_runs ADD COLUMN IF NOT EXISTS run_date date;
ALTER TABLE team_data_alerts ADD COLUMN IF NOT EXISTS seen_count integer NOT NULL DEFAULT 1;
ALTER TABLE team_data_alerts ADD COLUMN IF NOT EXISTS last_run_id uuid;

-- widen the alert-type vocabulary (every existing row already satisfies the wider list)
ALTER TABLE team_data_alerts DROP CONSTRAINT IF EXISTS ck_team_data_alert_type;
ALTER TABLE team_data_alerts ADD CONSTRAINT ck_team_data_alert_type CHECK (alert_type IN ('SHIFT_STATUS_MISMATCH', 'MISSING_SERVICE_MAPPING', 'COMMISSION_PAID_MISMATCH',
  'ATTENDANCE_DISAGREEMENT', 'DUPLICATE_CONTACT', 'STALE_USER_LINK', 'ORPHANED_ASSIGNMENT', 'MISSING_BRANCH_ASSOCIATION', 'DATA_CHECK_JOB_FAILED'));

-- the training history is append-only
CREATE OR REPLACE FUNCTION team_training_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME; END $$;
DROP TRIGGER IF EXISTS trg_tte_append_only ON team_training_events;
CREATE TRIGGER trg_tte_append_only BEFORE UPDATE OR DELETE ON team_training_events FOR EACH ROW EXECUTE FUNCTION team_training_events_append_only();
-- training assignments and certification records are never deleted (canceled / revoked instead)
CREATE OR REPLACE FUNCTION team_training_no_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '% rows are never deleted', TG_TABLE_NAME; END $$;
DROP TRIGGER IF EXISTS trg_tta_no_delete ON team_training_assignments;
CREATE TRIGGER trg_tta_no_delete BEFORE DELETE ON team_training_assignments FOR EACH ROW EXECUTE FUNCTION team_training_no_delete();
DROP TRIGGER IF EXISTS trg_tsc_no_delete ON team_staff_certifications;
CREATE TRIGGER trg_tsc_no_delete BEFORE DELETE ON team_staff_certifications FOR EACH ROW EXECUTE FUNCTION team_training_no_delete();
