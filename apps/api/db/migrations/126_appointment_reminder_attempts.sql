-- 126_appointment_reminder_attempts.sql
-- Delivery-status ledger for appointment reminders. The existing appointment_reminders_sent table is a
-- success-only idempotency ledger and cannot represent failures; this table records every terminal send
-- outcome (sent / failed / blocked) so Super Admin Appointment Oversight can surface real reminder failures
-- (§29 Reminder Monitoring, §19 "Failed reminder" alert) instead of an honest gap.
CREATE TABLE IF NOT EXISTS appointment_reminder_attempts (
  id             BIGSERIAL PRIMARY KEY,
  tenant_id      UUID NOT NULL,
  appointment_id UUID,
  channel        TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('sent','failed','blocked')),
  error          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reminder_attempts_tenant_created ON appointment_reminder_attempts (tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_reminder_attempts_status_created ON appointment_reminder_attempts (status, created_at);
