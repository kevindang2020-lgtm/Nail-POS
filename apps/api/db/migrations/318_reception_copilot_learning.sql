-- 318_reception_copilot_learning.sql — the learning loop (spec §36). Feedback (317) rolls up into LEARNING SUGGESTIONS;
-- a manager approves a suggestion, which records a versioned KNOWLEDGE entry. Two hard safety rules are structural here:
--   (1) Tenant isolation — every row carries tenant_id and all reads/writes filter on it; one salon's feedback can never
--       inform another's suggestions.
--   (2) No silent production change — a suggestion never auto-applies; approval writes an auditable knowledge VERSION
--       (a recorded human decision), it does not mutate live Copilot behavior on its own.
CREATE TABLE IF NOT EXISTS reception_copilot_learning_suggestions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL,
  branch_id      UUID,
  kind           TEXT NOT NULL,          -- the recommendation kind the suggestion is about
  suggestion     TEXT NOT NULL,          -- human-readable recommended adjustment
  evidence       JSONB NOT NULL DEFAULT '{}'::jsonb,  -- the stats that triggered it (helpful/not-helpful counts, rate)
  status         TEXT NOT NULL DEFAULT 'open',        -- open | approved | dismissed
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by     TEXT,
  decided_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_rc_learning_tenant_status ON reception_copilot_learning_suggestions (tenant_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS reception_copilot_knowledge_versions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL,
  version             INTEGER NOT NULL,   -- monotonically increasing PER TENANT
  source_suggestion_id UUID,
  content             JSONB NOT NULL DEFAULT '{}'::jsonb,  -- the approved knowledge adjustment
  created_by          TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  active              BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (tenant_id, version)
);
CREATE INDEX IF NOT EXISTS idx_rc_knowledge_tenant_version ON reception_copilot_knowledge_versions (tenant_id, version DESC);
