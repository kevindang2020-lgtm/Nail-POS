-- 035_technician_blocked_times.sql
-- The one table the Live Technician Schedule needs that did not already exist. Everything else the schedule reads
-- (technicians, technician_schedules, technician_statuses, technician_status_events, technician_services,
-- pos_tech_appointments) is already present and used by the technicians / tech-appointments / booking modules.
-- Blocked time removes a technician's availability for a window (doctor appt, training, late arrival, etc.).

CREATE TABLE IF NOT EXISTS technician_blocked_times (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL,
  branch_id          UUID NOT NULL,
  technician_id      UUID NOT NULL,
  block_date         DATE NOT NULL,
  start_time         TEXT NOT NULL,                 -- 'HH:MM' (24h), matches pos_tech_appointments.start_time
  end_time           TEXT NOT NULL,                 -- 'HH:MM' (24h)
  reason             TEXT NOT NULL DEFAULT 'unavailable',
  note               TEXT,
  created_by_user_id UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_technician_blocked_times_tenant_branch_tech
  ON technician_blocked_times (tenant_id, branch_id, technician_id, block_date);

-- Helpful indexes on the data the live schedule reads heavily (idempotent; no-ops if already present).
CREATE INDEX IF NOT EXISTS idx_technician_schedules_tenant_branch_tech_dow
  ON technician_schedules (tenant_id, branch_id, technician_id, day_of_week);

CREATE INDEX IF NOT EXISTS idx_pos_tech_appointments_tenant_branch_tech_date
  ON pos_tech_appointments (tenant_id, branch_id, technician_id, appt_date, status);

CREATE INDEX IF NOT EXISTS idx_technician_statuses_tenant_branch_tech
  ON technician_statuses (tenant_id, branch_id, technician_id);
