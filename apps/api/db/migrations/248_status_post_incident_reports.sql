-- 188_status_post_incident_reports.sql
-- Post-incident reports (a.k.a. postmortems) attached to resolved incidents. Kept separate from status_incidents so a
-- report has its own lifecycle (draft → published) and authorship without mutating the incident record.
CREATE TABLE IF NOT EXISTS status_post_incident_reports (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_reference   TEXT NOT NULL,
  incident_reference TEXT,
  title              TEXT NOT NULL,
  summary            TEXT,
  root_cause         TEXT,
  owner              TEXT,
  status             TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  published_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_status_pir_ref ON status_post_incident_reports (report_reference);
CREATE INDEX IF NOT EXISTS ix_status_pir_incident ON status_post_incident_reports (incident_reference);
