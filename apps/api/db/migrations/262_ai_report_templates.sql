-- 182_ai_report_templates.sql — report templates with immutable versioning. Publishing creates a new version; a
-- historical run keeps the version it used. `sections` is a structured definition (each section references specific
-- metric keys) used to build a GROUNDED narrative — the renderer may only surface metric values the run actually
-- computed; it can never invent numbers, and template text is treated as data (never executed).
CREATE TABLE IF NOT EXISTS ai_report_templates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_key    TEXT NOT NULL,
  name          TEXT NOT NULL,
  version       INTEGER NOT NULL DEFAULT 1,
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  sections      JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by    UUID,
  published_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ai_report_templates_version UNIQUE (report_key, version)
);
CREATE INDEX IF NOT EXISTS idx_ai_report_templates_key ON ai_report_templates (report_key, status, version DESC);
