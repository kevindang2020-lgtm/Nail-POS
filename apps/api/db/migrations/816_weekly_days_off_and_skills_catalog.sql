-- 816_weekly_days_off_and_skills_catalog.sql — Technician Profile & Team Management guide (Nov 5 2026, G3).
--
-- 1) technician_weekly_off_rules — a manager sets a technician off on one or more WEEKDAYS (e.g. every Monday + Tuesday)
--    from an effective date, until changed or an end date. A branch-local CALENDAR rule (weekday of the salon-local date),
--    never "every 168 hours". Versioned: changing the pattern ENDS the current rule the day before the new one starts, so
--    past dates keep the rule they had. Precedence (one schedule reader): date override (technician_shift_overrides, 719)
--    > weekly day-off rule > weekly template (technician_schedules) > store hours. Approved time off still subtracts.
--    Nothing here edits technician_schedules, bookings or payroll hours.
-- 2) tenant_skills / tenant_skill_services — the salon's reusable Skills Catalog (name, category, description, linked
--    EXISTING services). A skill holds no price or duration (the Service Catalog owns those). Archived, never deleted.
-- 3) technician_skill_assignments — a technician holds a skill: approved by an authorized manager (or via the existing
--    Skill Requests flow), effective / expiry, revoked with a reason. Approving grants the linked services in the ONE
--    eligibility table (technician_services, granted_via 'skill:<id>'); revoking removes only what the skill granted
--    and nothing another skill or a manager still grants. History stays.

CREATE TABLE IF NOT EXISTS technician_weekly_off_rules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  branch_id       uuid,
  technician_id   uuid NOT NULL,
  weekdays        smallint[] NOT NULL,
  effective_from  date NOT NULL,
  effective_to    date,
  status          text NOT NULL DEFAULT 'ACTIVE',
  reason          text,
  version         integer NOT NULL DEFAULT 1,
  created_by      uuid,
  updated_by      uuid,
  ended_by        uuid,
  ended_at        timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_twor_status CHECK (status IN ('ACTIVE', 'ENDED')),
  CONSTRAINT chk_twor_days CHECK (cardinality(weekdays) BETWEEN 1 AND 7 AND weekdays <@ ARRAY[0,1,2,3,4,5,6]::smallint[]),
  CONSTRAINT chk_twor_range CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT chk_twor_reason CHECK (reason IS NULL OR length(reason) <= 500)
);
CREATE INDEX IF NOT EXISTS ix_twor_tech ON technician_weekly_off_rules (tenant_id, technician_id, effective_from DESC);
CREATE INDEX IF NOT EXISTS ix_twor_active ON technician_weekly_off_rules (tenant_id, effective_from) WHERE status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS technician_weekly_off_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  technician_id   uuid NOT NULL,
  rule_id         uuid,
  action          text NOT NULL,
  before_json     jsonb,
  after_json      jsonb,
  reason          text,
  actor_user_id   uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_twoe_action CHECK (action IN ('CREATED', 'ENDED', 'SUPERSEDED'))
);
CREATE INDEX IF NOT EXISTS ix_twoe_tech ON technician_weekly_off_events (tenant_id, technician_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS tenant_skills (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  name            text NOT NULL,
  category        text,
  description     text,
  required_certification text,
  status          text NOT NULL DEFAULT 'active',
  version         integer NOT NULL DEFAULT 1,
  created_by      uuid,
  updated_by      uuid,
  archived_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_tsk_status CHECK (status IN ('active', 'archived')),
  CONSTRAINT chk_tsk_lengths CHECK (length(name) BETWEEN 1 AND 80 AND (category IS NULL OR length(category) <= 60) AND (description IS NULL OR length(description) <= 500)
    AND (required_certification IS NULL OR length(required_certification) <= 120))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tsk_name ON tenant_skills (tenant_id, lower(name));
CREATE INDEX IF NOT EXISTS ix_tsk_created ON tenant_skills (tenant_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS tenant_skill_services (
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  skill_id        uuid NOT NULL REFERENCES tenant_skills(id),
  service_id      uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, skill_id, service_id)
);

CREATE TABLE IF NOT EXISTS technician_skill_assignments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  branch_id       uuid,
  technician_id   uuid NOT NULL,
  skill_id        uuid NOT NULL REFERENCES tenant_skills(id),
  status          text NOT NULL,
  proficiency     text,
  effective_from  date NOT NULL DEFAULT current_date,
  expires_on      date,
  approved_by     uuid,
  approved_at     timestamptz,
  revoked_by      uuid,
  revoked_at      timestamptz,
  revoke_reason   text,
  version         integer NOT NULL DEFAULT 1,
  updated_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_tsa_status CHECK (status IN ('APPROVED', 'REVOKED')),
  CONSTRAINT chk_tsa_prof CHECK (proficiency IS NULL OR proficiency IN ('BASIC', 'INTERMEDIATE', 'ADVANCED', 'EXPERT')),
  CONSTRAINT chk_tsa_revoked CHECK (status <> 'REVOKED' OR (revoked_at IS NOT NULL AND revoke_reason IS NOT NULL)),
  CONSTRAINT chk_tsa_reason CHECK (revoke_reason IS NULL OR length(revoke_reason) <= 500)
);
-- one LIVE assignment per technician + skill; revoked rows stay as history
CREATE UNIQUE INDEX IF NOT EXISTS uq_tsa_live ON technician_skill_assignments (tenant_id, technician_id, skill_id) WHERE status = 'APPROVED';
CREATE INDEX IF NOT EXISTS ix_tsa_tech ON technician_skill_assignments (tenant_id, technician_id, created_at DESC);

-- B-12: every tenant→tenant reference refuses a crossed salon at the database
CREATE TRIGGER trg_tc_tenant_skill_services__skill_id BEFORE INSERT OR UPDATE OF tenant_id, skill_id ON tenant_skill_services
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('tenant_skills', 'skill_id');
CREATE TRIGGER trg_tc_technician_skill_assignments__skill_id BEFORE INSERT OR UPDATE OF tenant_id, skill_id ON technician_skill_assignments
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('tenant_skills', 'skill_id');

-- the weekly-off history is append-only
CREATE OR REPLACE FUNCTION twoe_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'technician_weekly_off_events is append-only' USING ERRCODE = 'P0001'; END $$;
DROP TRIGGER IF EXISTS trg_twoe_append_only ON technician_weekly_off_events;
CREATE TRIGGER trg_twoe_append_only BEFORE UPDATE OR DELETE ON technician_weekly_off_events FOR EACH ROW EXECUTE FUNCTION twoe_append_only();
