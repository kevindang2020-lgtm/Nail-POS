-- 316_reception_copilot_data_model.sql — dedicated persistence for the AI Reception Copilot (spec §37 foundation).
-- Two foundational tables: a working SESSION (a receptionist assisting a caller/customer) and the RECOMMENDATIONS shown
-- within it. Feedback (next slice) references a recommendation by id. Tenant/branch-scoped; no PII beyond ids — safe
-- attribution only. The authoritative appointment record still lives in `appointments`; these are the Copilot's own
-- advisory + audit trail.
CREATE TABLE IF NOT EXISTS reception_copilot_sessions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL,
  branch_id           UUID,
  receptionist_user_id TEXT NOT NULL,
  channel             TEXT NOT NULL DEFAULT 'pos',   -- pos | phone_assist
  status              TEXT NOT NULL DEFAULT 'active', -- active | ended
  started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at            TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_rc_sessions_tenant_started ON reception_copilot_sessions (tenant_id, started_at DESC);

CREATE TABLE IF NOT EXISTS reception_copilot_recommendations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL,
  branch_id           UUID,
  session_id          UUID,
  receptionist_user_id TEXT,
  kind                TEXT NOT NULL,   -- availability | technician | next_action | draft | waitlist | service_explanation | duplicate | conflict
  payload             JSONB NOT NULL DEFAULT '{}'::jsonb,   -- the recommendation content shown (no raw PII)
  acted_on            BOOLEAN NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rc_reco_tenant_created ON reception_copilot_recommendations (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rc_reco_session ON reception_copilot_recommendations (tenant_id, session_id);
