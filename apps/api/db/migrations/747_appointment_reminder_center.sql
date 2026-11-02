-- 747_appointment_reminder_center.sql — Appointment Reminders Complete Build & Repair Guide (Oct 30 2026). ADDITIVE.
-- The existing engine is scan-based (reminders.service: every run reads the CURRENT booked appointments and picks those
-- whose start lies inside [now+lead, now+lead+window)). Its idempotency ledger appointment_reminders_sent was keyed
-- (tenant, appointment, lead) and written only AFTER a send, so:
--   • two overlapping runs (the in-process 5-minute scheduler + the external /jobs route, or two instances) could both
--     send the same reminder (read sent-set → send → mark), and
--   • a rescheduled appointment never got a reminder for its NEW time once one had gone out for the old time.
-- This migration turns that ledger into the per-occurrence DISPATCH record — claimed atomically BEFORE the send, keyed
-- by the appointment's occurrence (date + start time), carrying its state, reason and provider link — and makes the
-- attempt log an append-only event trail. Pending (not yet due) reminders stay DERIVED from the live appointment, so a
-- reschedule or cancellation changes them by definition (nothing to invalidate) — and the dispatch step re-checks the
-- live appointment under a row lock before every claim and again right before the provider call.
-- Rollback: drop the added columns/indexes/table, then
--   DROP INDEX IF EXISTS ux_ars_occurrence;
--   ALTER TABLE appointment_reminders_sent ADD PRIMARY KEY (tenant_id, appointment_id, lead_minutes);  (after de-duplicating)
-- The legacy rows keep working either way.

-- ── 1. dispatch record (extends appointment_reminders_sent) ─────────────────────────────────────────────────────────
ALTER TABLE appointment_reminders_sent
  ADD COLUMN IF NOT EXISTS id               uuid DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS occurrence_key   text,                 -- 'YYYY-MM-DD HH:MM' of the appointment when claimed
  ADD COLUMN IF NOT EXISTS state            text,                 -- REMINDER_DISPATCH lifecycle (communications-lifecycles.ts)
  ADD COLUMN IF NOT EXISTS reason           text,                 -- machine reason code (opted_out, no_destination, quiet_hours, appointment_changed …)
  ADD COLUMN IF NOT EXISTS channel          text,
  ADD COLUMN IF NOT EXISTS branch_id        uuid,
  ADD COLUMN IF NOT EXISTS customer_id      uuid,
  ADD COLUMN IF NOT EXISTS intended_send_at timestamptz,          -- appointment start − lead (UTC instant)
  ADD COLUMN IF NOT EXISTS appt_start_at    timestamptz,          -- appointment start at claim time (UTC instant)
  ADD COLUMN IF NOT EXISTS notification_id  uuid,                 -- the provider-facing record (notifications.id) of the latest attempt
  ADD COLUMN IF NOT EXISTS attempt_count    int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS created_at       timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at       timestamptz,
  ADD COLUMN IF NOT EXISTS updated_by       uuid;

-- legacy rows (success-only ledger): a reminder (or an opt-out block) went out. Their occurrence is the appointment's
-- CURRENT time — the best evidence there is; an appointment rescheduled before this deploy gets no second reminder for
-- its old slot and, at worst, none for a new slot already inside the window (documented, not guessed).
UPDATE appointment_reminders_sent s SET
  id = coalesce(s.id, gen_random_uuid()),
  state = coalesce(s.state, 'submitted'),
  reason = coalesce(s.reason, 'legacy_ledger'),
  created_at = coalesce(s.created_at, s.reminded_at),
  updated_at = coalesce(s.updated_at, s.reminded_at),
  occurrence_key = coalesce(s.occurrence_key,
    (SELECT to_char(a.appt_date, 'YYYY-MM-DD') || ' ' || left(a.start_time, 5) FROM pos_tech_appointments a WHERE a.id = s.appointment_id AND a.tenant_id = s.tenant_id),
    'legacy')
WHERE s.state IS NULL OR s.occurrence_key IS NULL OR s.id IS NULL;

-- expand → backfill → contract (DEPLOYMENT.md): every row is backfilled above and every new row is written with these
-- values by the code; the NOT NULL contract follows in a later release once this one is everywhere.
ALTER TABLE appointment_reminders_sent ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE appointment_reminders_sent ALTER COLUMN updated_at SET DEFAULT now();

DO $$ BEGIN
  ALTER TABLE appointment_reminders_sent ADD CONSTRAINT ck_ars_state CHECK (state IN ('claimed','submitted','failed','skipped','cancelled','deferred'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- the old key (tenant, appointment, lead) becomes (tenant, appointment, lead, occurrence): a rescheduled appointment
-- gets its own reminder for the new time; the same occurrence can still never be claimed twice.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'appointment_reminders_sent_pkey') THEN
    ALTER TABLE appointment_reminders_sent DROP CONSTRAINT appointment_reminders_sent_pkey;
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS ux_ars_occurrence ON appointment_reminders_sent (tenant_id, appointment_id, lead_minutes, occurrence_key);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ars_tenant_id ON appointment_reminders_sent (tenant_id, id);
CREATE INDEX IF NOT EXISTS ix_ars_tenant_created ON appointment_reminders_sent (tenant_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS ix_ars_tenant_state ON appointment_reminders_sent (tenant_id, state, updated_at DESC);
CREATE INDEX IF NOT EXISTS ix_ars_tenant_customer ON appointment_reminders_sent (tenant_id, customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_ars_notification ON appointment_reminders_sent (notification_id) WHERE notification_id IS NOT NULL;

-- ── 2. the attempt log becomes the append-only event trail ──────────────────────────────────────────────────────────
ALTER TABLE appointment_reminder_attempts
  ADD COLUMN IF NOT EXISTS dispatch_id      uuid,
  ADD COLUMN IF NOT EXISTS notification_id  uuid,
  ADD COLUMN IF NOT EXISTS kind             text NOT NULL DEFAULT 'automatic',   -- automatic | manual_retry | staff_cancel | system
  ADD COLUMN IF NOT EXISTS actor_user_id    uuid,
  ADD COLUMN IF NOT EXISTS idempotency_key  text,
  ADD COLUMN IF NOT EXISTS occurrence_key   text,
  ADD COLUMN IF NOT EXISTS note             text;
ALTER TABLE appointment_reminder_attempts DROP CONSTRAINT IF EXISTS appointment_reminder_attempts_status_check;
DO $$ BEGIN
  ALTER TABLE appointment_reminder_attempts ADD CONSTRAINT ck_ara_status CHECK (status IN ('sent','failed','blocked','claimed','skipped','cancelled','deferred','retry_requested'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE appointment_reminder_attempts ADD CONSTRAINT ck_ara_kind CHECK (kind IN ('automatic','manual_retry','staff_cancel','system'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS ux_ara_idempotency ON appointment_reminder_attempts (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_ara_dispatch ON appointment_reminder_attempts (dispatch_id, created_at) WHERE dispatch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_ara_tenant_appt ON appointment_reminder_attempts (tenant_id, appointment_id, created_at DESC);

-- ── 3. durable per-salon run record (the in-process job registry dies with the process) ─────────────────────────────
CREATE TABLE IF NOT EXISTS appointment_reminder_runs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  trigger      text NOT NULL CHECK (trigger IN ('scheduler','jobs_route','manual')),
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  outcome      text NOT NULL DEFAULT 'running' CHECK (outcome IN ('running','ok','partial','failed')),
  candidates   int NOT NULL DEFAULT 0,
  submitted    int NOT NULL DEFAULT 0,
  skipped      int NOT NULL DEFAULT 0,
  deferred     int NOT NULL DEFAULT 0,
  failed       int NOT NULL DEFAULT 0,
  cancelled    int NOT NULL DEFAULT 0,
  error        text
);
CREATE INDEX IF NOT EXISTS ix_arr_tenant_started ON appointment_reminder_runs (tenant_id, started_at DESC);

-- ── 4. upcoming-queue read path (derived from live appointments) ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS ix_pta_tenant_status_date ON pos_tech_appointments (tenant_id, status, appt_date);
