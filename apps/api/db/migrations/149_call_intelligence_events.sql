-- 149_call_intelligence_events.sql
-- Call-intelligence substrate (spec §12–16): one row per provider call event so AI Receptionist & Call Intelligence
-- (calls handled, missed-calls queue, recovered bookings, call summary, call-to-booking rate) can be computed from
-- REAL data instead of fixtures. Idempotent on (tenant_id, provider_call_id) so a re-delivered telephony webhook never
-- creates a duplicate call/recovery (spec §13). Tenant- and branch-scoped; no rows seeded.

CREATE TABLE IF NOT EXISTS call_intelligence_events (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL,
  branch_id                UUID,
  provider_call_id         TEXT NOT NULL,
  customer_id              UUID,
  caller_phone             TEXT,
  direction                TEXT NOT NULL DEFAULT 'inbound' CHECK (direction IN ('inbound','outbound')),
  status                   TEXT NOT NULL CHECK (status IN ('missed','answered_ai','answered_human','voicemail')),
  ai_handled               BOOLEAN NOT NULL DEFAULT false,
  intent                   TEXT,
  duration_seconds         INTEGER NOT NULL DEFAULT 0,
  outcome                  TEXT NOT NULL DEFAULT 'no_action'
                           CHECK (outcome IN ('booked','recovered','transferred','message','no_action')),
  recovered_appointment_id UUID REFERENCES pos_tech_appointments(id) ON DELETE SET NULL,
  started_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider_call_id)
);
CREATE INDEX IF NOT EXISTS idx_call_intel_tenant_time   ON call_intelligence_events (tenant_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_call_intel_tenant_status ON call_intelligence_events (tenant_id, status, started_at DESC);
