-- 759_ai_follow_up_center.sql — AI Follow-Ups & Human Handoff Center (AI Follow-Ups Complete Build Guide, Oct 31 2026).
-- Extends the ONE task table (ai_receptionist_follow_ups, migration 303) instead of adding a parallel task system:
--   • a DURABLE handoff correlation key (source_event_key, unique per tenant even after the task is resolved — the old
--     partial index only stopped duplicates while a task was open, so a late webhook retry re-created a resolved task)
--   • optimistic version, due time zone, resolution category, contact counters, escalation level, customer match quality
--   • append-only activity (assignments, status, notes, priority, escalations), staff contact attempts, handoff events,
--     overdue escalations (one per task per rule), and the read-only health-check runs.
-- Additive except one index swap (uq_air_followup_open_call → uq_air_followup_open_call_reason). ROLLBACK (manual, in order):
--   recreate uq_air_followup_open_call (303) only after resolving duplicate open tasks per call; then drop table ai_follow_up_health_runs, ai_follow_up_escalations,
--   ai_follow_up_contact_attempts, ai_follow_up_activity, ai_handoff_events; drop index uq_air_followup_source_key,
--   idx_air_followups_due, idx_air_followups_assignee, idx_air_followups_list; alter table ai_receptionist_follow_ups drop
--   the added columns (source_event_key, version, due_tz, resolution_category, customer_match, contact_attempts,
--   first_contact_at, last_contact_at, escalation_level, escalated_at, reopened_count, waiting_until, description,
--   updated_by, assigned_at).

ALTER TABLE ai_receptionist_follow_ups
  ADD COLUMN IF NOT EXISTS source_event_key   TEXT,
  ADD COLUMN IF NOT EXISTS version            INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS due_tz             TEXT,
  ADD COLUMN IF NOT EXISTS resolution_category TEXT,
  ADD COLUMN IF NOT EXISTS customer_match     TEXT,          -- linked | phone_single | ambiguous | unmatched | manual
  ADD COLUMN IF NOT EXISTS contact_attempts   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS first_contact_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_contact_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS escalation_level   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS escalated_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reopened_count     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS waiting_until      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS description        TEXT,
  ADD COLUMN IF NOT EXISTS assigned_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_by         UUID;

-- one task per (tenant, handoff correlation) for good — a webhook retry after resolution can never re-create it
CREATE UNIQUE INDEX IF NOT EXISTS uq_air_followup_source_key ON ai_receptionist_follow_ups (tenant_id, source_event_key) WHERE source_event_key IS NOT NULL;
-- the 303 partial index allowed ONE open task per call; a callback and a complaint from the same call are two tasks
-- (guide §11: unique per source event + follow-up type), so it becomes one open task per call AND reason
CREATE UNIQUE INDEX IF NOT EXISTS uq_air_followup_open_call_reason ON ai_receptionist_follow_ups (tenant_id, provider_call_id, reason)
  WHERE provider_call_id IS NOT NULL AND status NOT IN ('resolved', 'closed');
DROP INDEX IF EXISTS uq_air_followup_open_call;
CREATE INDEX IF NOT EXISTS idx_air_followups_due ON ai_receptionist_follow_ups (tenant_id, due_at) WHERE status NOT IN ('resolved', 'closed');
CREATE INDEX IF NOT EXISTS idx_air_followups_assignee ON ai_receptionist_follow_ups (tenant_id, assigned_user_id, status);
CREATE INDEX IF NOT EXISTS idx_air_followups_list ON ai_receptionist_follow_ups (tenant_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_air_followups_call ON ai_receptionist_follow_ups (tenant_id, provider_call_id) WHERE provider_call_id IS NOT NULL;

-- what the voice side reported, one row per provider event / gateway request (the "handoff_event" logical record)
CREATE TABLE IF NOT EXISTS ai_handoff_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  branch_id         UUID,
  provider_call_id  TEXT NOT NULL,
  source            TEXT NOT NULL,               -- retell_webhook | gateway_handoff
  source_key        TEXT NOT NULL,               -- provider event key / gateway request key
  kind              TEXT NOT NULL CHECK (kind IN ('handoff_requested', 'transfer_attempted', 'transfer_completed', 'transfer_failed', 'callback_requested', 'complaint')),
  callback_required BOOLEAN NOT NULL DEFAULT false,
  reason            TEXT,
  follow_up_id      UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, source_key, kind)
);
CREATE INDEX IF NOT EXISTS idx_ai_handoff_events_call ON ai_handoff_events (tenant_id, provider_call_id);
CREATE INDEX IF NOT EXISTS idx_ai_handoff_events_created ON ai_handoff_events (tenant_id, created_at DESC);

-- append-only task history (status, assignment, priority, notes, escalation, linkage)
CREATE TABLE IF NOT EXISTS ai_follow_up_activity (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  follow_up_id  UUID NOT NULL,
  actor_user_id UUID,
  event_type    TEXT NOT NULL,
  from_value    TEXT,
  to_value      TEXT,
  note          TEXT,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_ai_follow_up_activity_task ON ai_follow_up_activity (tenant_id, follow_up_id, created_at);
CREATE OR REPLACE FUNCTION ai_follow_up_activity_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'ai_follow_up_activity is append-only'; END $$;
DROP TRIGGER IF EXISTS trg_ai_follow_up_activity_append_only ON ai_follow_up_activity;
CREATE TRIGGER trg_ai_follow_up_activity_append_only BEFORE UPDATE OR DELETE ON ai_follow_up_activity
  FOR EACH ROW EXECUTE FUNCTION ai_follow_up_activity_append_only();

-- staff contact attempts: a recorded phone outcome is the staff member's attestation; a text carries its notification
CREATE TABLE IF NOT EXISTS ai_follow_up_contact_attempts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL,
  follow_up_id     UUID NOT NULL,
  channel          TEXT NOT NULL CHECK (channel IN ('phone_call', 'sms', 'email', 'in_person')),
  actor_user_id    UUID NOT NULL,
  recipient_ref    TEXT,                          -- masked
  outcome          TEXT NOT NULL CHECK (outcome IN ('reached', 'no_answer', 'voicemail', 'wrong_number', 'requested_later', 'resolved', 'escalated', 'submitted', 'provider_accepted', 'delivered', 'failed', 'blocked', 'unknown')),
  notification_id  UUID,
  request_key      TEXT,
  idempotency_key  TEXT NOT NULL,
  note             TEXT,
  next_attempt_at  TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_ai_follow_up_attempts_task ON ai_follow_up_contact_attempts (tenant_id, follow_up_id, created_at);

-- overdue escalation: one per task per rule (the job is idempotent), linked to the owner alert it raised
CREATE TABLE IF NOT EXISTS ai_follow_up_escalations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  follow_up_id    UUID NOT NULL,
  rule            TEXT NOT NULL,                  -- overdue | overdue_urgent | manual
  severity        TEXT NOT NULL,
  owner_alert_id  UUID,
  triggered_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_at TIMESTAMPTZ,
  resolved_at     TIMESTAMPTZ,
  UNIQUE (tenant_id, follow_up_id, rule)
);

-- Check Follow-Up System runs (read-only checks; this table only records that they ran)
CREATE TABLE IF NOT EXISTS ai_follow_up_health_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  branch_id     UUID,
  actor_user_id UUID,
  overall       TEXT NOT NULL,
  results       JSONB NOT NULL DEFAULT '[]'::jsonb,
  ran_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_follow_up_health_runs ON ai_follow_up_health_runs (tenant_id, ran_at DESC);
