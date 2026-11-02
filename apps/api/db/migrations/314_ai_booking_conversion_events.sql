-- 314_ai_booking_conversion_events.sql — per-tenant, per-branch, per-source funnel events for the shared AI Booking
-- Assistant (ai_booking). Append-only analytics; NOT the authoritative booking record (that stays in appointments).
-- No private conversational content is stored here — only the funnel stage, outcome, and safe attribution. Tenant-scoped
-- by design; every read must filter by tenant_id.
CREATE TABLE IF NOT EXISTS ai_booking_conversion_events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL,
  branch_id      UUID,
  source         TEXT NOT NULL,            -- AiBookingSource (channel)
  stage          TEXT NOT NULL,            -- BOOKING_INTENT_DETECTED | AVAILABILITY_SEARCHED | OPTIONS_PRESENTED | … | BOOKING_SUCCEEDED | BOOKING_FAILED | HUMAN_HANDOFF | ABANDONED
  outcome        TEXT,                     -- succeeded | failed | abandoned | null (in-progress)
  failure_reason TEXT,                     -- stable failure category (NO_AVAILABILITY, APPOINTMENT_CONFLICT, …) when outcome=failed
  appointment_id TEXT,                     -- set once a booking is created (analytics reference, not a FK)
  actor_user_id  TEXT,                     -- user/integration/agent identity (may be 'super-admin' or an integration id)
  correlation_id TEXT,                     -- ties the funnel stages of one session together
  latency_ms     INTEGER,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_booking_conv_tenant_source_created ON ai_booking_conversion_events (tenant_id, source, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_booking_conv_tenant_branch_stage   ON ai_booking_conversion_events (tenant_id, branch_id, stage);
CREATE INDEX IF NOT EXISTS idx_ai_booking_conv_correlation           ON ai_booking_conversion_events (tenant_id, correlation_id);
