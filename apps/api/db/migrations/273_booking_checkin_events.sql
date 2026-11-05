-- 175_booking_checkin_events.sql — the dedicated event stores the Booking & Check-In Monitor reads. Until now those
-- four sections rendered honest "not yet provisioned" because no table existed; these tables give them a real source.
-- The Super Admin surface is READ-ONLY over them; rows are written by the booking/check-in pipeline (emitters land in a
-- follow-up unit). Every table is tenant + branch scoped and indexed for the monitor's range/scope/status queries.
-- Safe diagnostic detail only — no secrets, tokens, payment data, or raw confidential payloads are stored here.

-- Failed booking + check-in technical events (powers the Failed Events module + the failed-check-in / API-failure KPIs).
CREATE TABLE IF NOT EXISTS booking_checkin_failed_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_code       TEXT NOT NULL DEFAULT ('EVT-' || substr(replace(gen_random_uuid()::text,'-',''),1,8)),
  tenant_id        UUID NOT NULL,
  branch_id        UUID,
  category         TEXT NOT NULL DEFAULT 'check_in'      -- check_in | booking | api
                     CHECK (category IN ('check_in','booking','api','integration')),
  booking_id       UUID,
  checkin_id       UUID,
  appointment_id   UUID,
  device_id        UUID,
  source           TEXT,                                  -- original event source (never overwritten)
  check_in_method  TEXT,
  failure_type     TEXT NOT NULL DEFAULT 'unknown_error', -- validation_error | api_timeout | device_offline | ...
  error_code       TEXT,
  error_message    TEXT,                                  -- SAFE, redacted message only
  correlation_id   TEXT,
  retry_status     TEXT NOT NULL DEFAULT 'failed'         -- failed | retrying | retry_available | resolved | not_retryable
                     CHECK (retry_status IN ('failed','retrying','retry_available','resolved','not_retryable')),
  retry_count      INTEGER NOT NULL DEFAULT 0,
  attempt_count    INTEGER NOT NULL DEFAULT 1,
  escalation_state TEXT NOT NULL DEFAULT 'none',
  resolution       TEXT,
  occurred_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_attempt_at  TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bcfe_scope_time_idx ON booking_checkin_failed_events (tenant_id, branch_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS bcfe_category_idx ON booking_checkin_failed_events (category, occurred_at DESC);
CREATE INDEX IF NOT EXISTS bcfe_retry_idx ON booking_checkin_failed_events (retry_status);

-- AI receptionist handoffs (powers the AI Handoff Monitor module). Minimal necessary detail; no call transcripts here.
CREATE TABLE IF NOT EXISTS ai_receptionist_handoffs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_code        TEXT NOT NULL DEFAULT ('CALL-' || substr(replace(gen_random_uuid()::text,'-',''),1,8)),
  tenant_id        UUID NOT NULL,
  branch_id        UUID,
  ai_session_id    UUID,
  customer_ref     TEXT,
  transferred_to   TEXT NOT NULL DEFAULT 'front_desk',    -- front_desk | stylist | receptionist | branch_queue | human_agent
  reason           TEXT,                                   -- complex_request | human_request | pricing_inquiry | ...
  status           TEXT NOT NULL DEFAULT 'requested'
                     CHECK (status IN ('requested','connecting','completed','failed','abandoned','timed_out','escalated','returned_to_ai')),
  requested_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  connected_at     TIMESTAMPTZ,
  wait_seconds     INTEGER,
  failure_reason   TEXT,
  booking_result   TEXT,
  support_case_id  UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS aih_scope_time_idx ON ai_receptionist_handoffs (tenant_id, branch_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS aih_status_idx ON ai_receptionist_handoffs (status);

-- Unmatched customer records (powers the Unmatched Customer Records module + KPI). Tenant-scoped matching only.
CREATE TABLE IF NOT EXISTS unmatched_customer_records (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL,
  branch_id        UUID,
  display_name     TEXT,
  normalized_phone TEXT,
  normalized_email TEXT,
  source           TEXT,                                   -- online | ai_receptionist | mobile_app | kiosk | ...
  possible_matches INTEGER NOT NULL DEFAULT 0,             -- count of in-tenant candidate matches (never cross-tenant)
  review_state     TEXT NOT NULL DEFAULT 'pending'
                     CHECK (review_state IN ('pending','in_review','matched','dismissed')),
  resolution       TEXT,
  reviewer_user_id UUID,
  last_contact_at  TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ucr_scope_idx ON unmatched_customer_records (tenant_id, branch_id, review_state);
CREATE INDEX IF NOT EXISTS ucr_contact_idx ON unmatched_customer_records (last_contact_at DESC);

-- Duplicate check-in candidates (powers the Duplicate Check-Ins KPI + duplicate rate). Candidates only — never auto-deleted.
CREATE TABLE IF NOT EXISTS duplicate_checkin_candidates (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL,
  branch_id        UUID,
  customer_ref     TEXT,
  appointment_id   UUID,
  device_id        UUID,
  check_in_method  TEXT,
  match_reasons    JSONB NOT NULL DEFAULT '[]'::jsonb,
  confidence       NUMERIC(4,3) NOT NULL DEFAULT 0,
  review_state     TEXT NOT NULL DEFAULT 'pending'
                     CHECK (review_state IN ('pending','in_review','confirmed','dismissed')),
  resolution       TEXT,
  reviewer_user_id UUID,
  detected_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dcc_scope_time_idx ON duplicate_checkin_candidates (tenant_id, branch_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS dcc_state_idx ON duplicate_checkin_candidates (review_state);
