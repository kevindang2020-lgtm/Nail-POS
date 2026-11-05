-- 306_ai_receptionist_provisioning_jobs.sql — durable jobs that provision a draft agent through the voice provider.
-- State is persisted so the UI can poll and survive a page reload. A partial unique index allows only one active
-- (pending/running) job per agent, so a double-click never starts two provisions. On failure the job records an
-- honest error_code + safe_error_message (e.g. provider not connected) rather than fake progress.

CREATE TABLE IF NOT EXISTS ai_receptionist_provisioning_jobs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL,
  branch_id          UUID,
  agent_id           UUID NOT NULL,
  status             TEXT NOT NULL DEFAULT 'pending',   -- pending | running | succeeded | failed
  current_step       TEXT,
  progress           INTEGER NOT NULL DEFAULT 0,        -- 0..100
  error_code         TEXT,
  safe_error_message TEXT,
  provider_agent_id  TEXT,
  idempotency_key    TEXT,
  created_by_user_id UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_air_provjobs_tenant_agent ON ai_receptionist_provisioning_jobs (tenant_id, agent_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_air_provjob_active ON ai_receptionist_provisioning_jobs (tenant_id, agent_id)
  WHERE status IN ('pending', 'running');
