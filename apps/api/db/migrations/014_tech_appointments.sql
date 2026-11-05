-- 014_tech_appointments.sql — AIPowerSalon Tech Appointments. Idempotent.
-- Reuses appointments / appointment_service_lines / technicians from earlier migrations.
-- Adds a standby waitlist and a reschedule audit, plus scheduling read indexes.

CREATE TABLE IF NOT EXISTS appointment_waitlist (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  branch_id     UUID NOT NULL,
  customer_id   UUID NOT NULL,
  service_id    UUID,
  preferred_technician_id UUID,
  eta_time      TIMESTAMPTZ,
  position      INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'waiting',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS appointment_reschedules (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL,
  branch_id      UUID NOT NULL,
  appointment_id UUID NOT NULL,
  from_technician_id UUID,
  to_technician_id   UUID,
  from_start_time TIMESTAMPTZ,
  to_start_time   TIMESTAMPTZ,
  reason          TEXT,
  changed_by_user_id UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- scheduling read indexes
CREATE INDEX IF NOT EXISTS idx_appointments_tenant_branch_tech_start
  ON appointments (tenant_id, branch_id, technician_id, start_time);
CREATE INDEX IF NOT EXISTS idx_appointments_tenant_branch_start_status3
  ON appointments (tenant_id, branch_id, start_time, status);
CREATE INDEX IF NOT EXISTS idx_waitlist_tenant_branch_status
  ON appointment_waitlist (tenant_id, branch_id, status, position);
CREATE INDEX IF NOT EXISTS idx_reschedules_tenant_branch_appt
  ON appointment_reschedules (tenant_id, branch_id, appointment_id);
