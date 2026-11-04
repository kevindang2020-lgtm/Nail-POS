-- 790_ai_booking_center.sql — A7 AI Booking Assistant guide (Nov 4 2026): the salon's operations center reads the EXISTING
-- records (ai_booking_conversion_events, booking_holds, booking_verification_sessions, pos_tech_appointments,
-- voice_tool_executions) — no parallel booking store. Two small tables only:
--   ai_booking_health_runs          each "Check AI Booking System" run (per-part status, evidence, fix) — read-only checks
--   ai_booking_recovery_dismissals  a recovery case staff dismissed (who, why) so it stops showing; the case itself is derived
CREATE TABLE IF NOT EXISTS ai_booking_health_runs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id   UUID REFERENCES branches(id) ON DELETE CASCADE,
  overall     TEXT NOT NULL CHECK (overall IN ('READY','ATTENTION_REQUIRED','FAILED','DISABLED','NOT_CONFIGURED','UNKNOWN')),
  checks      JSONB NOT NULL DEFAULT '[]'::jsonb,
  checked_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_ai_booking_health_runs ON ai_booking_health_runs (tenant_id, branch_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS ai_booking_recovery_dismissals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  case_key      TEXT NOT NULL,
  reason        TEXT,
  dismissed_by  UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_booking_recovery_dismissal ON ai_booking_recovery_dismissals (tenant_id, case_key);
-- B-12: the location must belong to the same salon (the trigger every tenant FK carries)
DROP TRIGGER IF EXISTS trg_tc_ai_booking_health_runs__branch_id ON ai_booking_health_runs;
CREATE TRIGGER trg_tc_ai_booking_health_runs__branch_id BEFORE INSERT OR UPDATE OF tenant_id, branch_id ON ai_booking_health_runs FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('branches', 'branch_id');
