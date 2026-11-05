-- 009_booking.sql — AIPowerSalon Booking (§27). Tenant-scoped. Idempotent.
-- appointments / appointment_service_lines may already exist from earlier migrations: CREATE ... IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS appointments (
  id                             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                      UUID NOT NULL,
  branch_id                      UUID NOT NULL,
  customer_id                    UUID NOT NULL,
  technician_id                  UUID,
  start_time                     TIMESTAMPTZ NOT NULL,
  end_time                       TIMESTAMPTZ NOT NULL,
  status                         TEXT NOT NULL DEFAULT 'pending_confirmation',
  source                         TEXT NOT NULL DEFAULT 'pos_manual',
  notes                          TEXT,
  confirmation_required          BOOLEAN NOT NULL DEFAULT FALSE,
  confirmed_at                   TIMESTAMPTZ,
  cancelled_at                   TIMESTAMPTZ,
  no_show_at                     TIMESTAMPTZ,
  rescheduled_from_appointment_id UUID,
  created_by_user_id             UUID,
  created_at                     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS appointment_service_lines (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL,
  branch_id                UUID NOT NULL,
  appointment_id           UUID NOT NULL,
  service_id               UUID NOT NULL,
  service_name_snapshot    TEXT NOT NULL,
  price_cents_snapshot     INTEGER NOT NULL DEFAULT 0,
  duration_minutes_snapshot INTEGER NOT NULL DEFAULT 0,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS booking_holds (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL,
  branch_id           UUID NOT NULL,
  technician_id       UUID,
  customer_id         UUID,
  service_ids_json    JSONB NOT NULL DEFAULT '[]'::jsonb,
  start_time          TIMESTAMPTZ NOT NULL,
  end_time            TIMESTAMPTZ NOT NULL,
  expires_at          TIMESTAMPTZ NOT NULL,
  status              TEXT NOT NULL DEFAULT 'held',
  created_by_user_id  UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_appointments_tenant_branch_start
  ON appointments (tenant_id, branch_id, start_time);
CREATE INDEX IF NOT EXISTS idx_appointments_tenant_branch_status
  ON appointments (tenant_id, branch_id, status);
CREATE INDEX IF NOT EXISTS idx_appointments_tenant_tech_time
  ON appointments (tenant_id, branch_id, technician_id, start_time, end_time);
CREATE INDEX IF NOT EXISTS idx_appt_service_lines_appt
  ON appointment_service_lines (tenant_id, appointment_id);
CREATE INDEX IF NOT EXISTS idx_booking_holds_tenant_tech_expires
  ON booking_holds (tenant_id, branch_id, technician_id, expires_at);
