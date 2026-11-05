-- 331_queue_assignment_core.sql — AI Queue Assignment persistence (intelligence layer on top of the existing queue).
-- Recommendations + their candidate techs + staff decisions. Every row is tenant + branch scoped. No existing queue,
-- tech-queue, or technician table is modified. queue_entry_id references the existing queue lifecycle by id (soft
-- reference — the queue owns the entry; we only annotate it with recommendations/decisions).
CREATE TABLE IF NOT EXISTS queue_assignment_recommendations (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL,
  branch_id          UUID NOT NULL,
  queue_entry_id     TEXT NOT NULL,
  recommended_tech   TEXT,                 -- chosen technician id (null = no eligible technician)
  match_score        NUMERIC(10,3),
  confidence         NUMERIC(5,4) NOT NULL DEFAULT 0,
  required_action    TEXT NOT NULL CHECK (required_action IN ('assignable','staff_review','no_eligible_technician')),
  conflicts          JSONB NOT NULL DEFAULT '[]'::jsonb,
  warnings           JSONB NOT NULL DEFAULT '[]'::jsonb,
  rule_version       TEXT NOT NULL,
  reco_version       TEXT NOT NULL,
  envelope           JSONB NOT NULL,        -- full structured envelope (alternates, reasons, estimates)
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_qar_tenant_entry ON queue_assignment_recommendations (tenant_id, branch_id, queue_entry_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_qar_tenant_time  ON queue_assignment_recommendations (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS queue_assignment_candidates (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL,
  branch_id          UUID NOT NULL,
  recommendation_id  UUID NOT NULL REFERENCES queue_assignment_recommendations(id) ON DELETE CASCADE,
  technician_id      TEXT NOT NULL,
  rank               INTEGER NOT NULL,      -- 0 = recommended, 1+ = alternates
  match_score        NUMERIC(10,3) NOT NULL,
  eligible           BOOLEAN NOT NULL DEFAULT true,
  reasons            JSONB NOT NULL DEFAULT '[]'::jsonb,
  warnings           JSONB NOT NULL DEFAULT '[]'::jsonb,
  est_start_min      INTEGER,
  est_completion_min INTEGER,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_qac_recommendation ON queue_assignment_candidates (recommendation_id, rank);

CREATE TABLE IF NOT EXISTS queue_assignment_decisions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL,
  branch_id          UUID NOT NULL,
  recommendation_id  UUID REFERENCES queue_assignment_recommendations(id) ON DELETE SET NULL,
  queue_entry_id     TEXT NOT NULL,
  decision           TEXT NOT NULL CHECK (decision IN ('accepted','rejected','overridden','kept_unassigned')),
  chosen_technician  TEXT,
  reason             TEXT,
  decided_by         TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_qad_tenant_entry ON queue_assignment_decisions (tenant_id, branch_id, queue_entry_id, created_at DESC);
