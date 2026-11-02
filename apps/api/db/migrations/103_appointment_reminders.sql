-- MERGE: ported from Project B migration 044 (renumbered to avoid collision with Project A 044_*).
-- 044_appointment_reminders.sql — per-tenant appointment-reminder config + idempotency log.
-- The reminder job (POST /jobs/appointment-reminders, external scheduler) reads reminder_settings for enabled
-- tenants, sends via the notifications path (credits + opt-outs enforced), and records each send here so a
-- given appointment is reminded at most once.

CREATE TABLE IF NOT EXISTS reminder_settings (
  tenant_id      UUID PRIMARY KEY,
  enabled        BOOLEAN NOT NULL DEFAULT false,
  lead_minutes   INT NOT NULL DEFAULT 1440,   -- how far ahead to remind (default 24h)
  window_minutes INT NOT NULL DEFAULT 60,     -- firing window size (≈ scheduler cadence)
  channel        TEXT NOT NULL DEFAULT 'sms' CHECK (channel IN ('sms','email')),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS appointment_reminders_sent (
  tenant_id      UUID NOT NULL,
  appointment_id UUID NOT NULL,
  reminded_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, appointment_id)
);
