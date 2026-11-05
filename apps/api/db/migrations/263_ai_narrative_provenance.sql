-- 183_ai_narrative_provenance.sql — model/prompt version registry + per-narrative provenance. Every AI narrative records
-- WHICH template version, model, and prompt version produced it, and whether it passed grounding validation — so any
-- report's narrative is fully auditable and reproducible. prompt_hash pins the exact prompt used.
CREATE TABLE IF NOT EXISTS ai_narrative_model_versions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_name     TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  prompt_hash    TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','retired')),
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ai_narrative_model_versions_uniq UNIQUE (model_name, prompt_version)
);
CREATE INDEX IF NOT EXISTS idx_ai_model_versions_status ON ai_narrative_model_versions (model_name, status);

CREATE TABLE IF NOT EXISTS ai_report_narratives (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id            UUID NOT NULL REFERENCES ai_report_runs (id) ON DELETE CASCADE,
  template_id       UUID,
  template_version  INTEGER,
  model_version_id  UUID REFERENCES ai_narrative_model_versions (id) ON DELETE SET NULL,
  all_grounded      BOOLEAN NOT NULL DEFAULT FALSE,
  grounding_ok      BOOLEAN NOT NULL DEFAULT FALSE,
  offending_count   INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ai_report_narratives_run_uniq UNIQUE (run_id)
);
CREATE INDEX IF NOT EXISTS idx_ai_report_narratives_run ON ai_report_narratives (run_id);
