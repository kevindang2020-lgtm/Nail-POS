-- 420_security_audit_engine.sql — the persistent server-side Security Audit Engine (Kevin's architecture, Jul 26 2026):
-- 1:00 AM → engine → findings → DEDUPLICATE (fingerprint) → Super Admin review (via the EXISTING security_incidents
-- workflow for critical/high) → fix → RE-VERIFY (auto-resolve when a finding stops appearing) → close.
-- Platform-level tables (no tenant_id): the audit engine inspects the whole platform.
CREATE TABLE IF NOT EXISTS security_audit_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger       TEXT NOT NULL CHECK (trigger IN ('scheduled','manual')),
  status        TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','failed')),
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ,
  checks_run    INTEGER NOT NULL DEFAULT 0,
  findings_open INTEGER NOT NULL DEFAULT 0,
  findings_resolved INTEGER NOT NULL DEFAULT 0,
  error         TEXT,
  triggered_by_user_id UUID
);
CREATE TABLE IF NOT EXISTS security_audit_findings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint   TEXT NOT NULL UNIQUE,          -- dedupe key: area|title (stable across runs)
  area          TEXT NOT NULL,
  title         TEXT NOT NULL,
  detail        TEXT,
  severity      TEXT NOT NULL CHECK (severity IN ('critical','high','medium','low','informational')),
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','reopened','resolved')),
  occurrences   INTEGER NOT NULL DEFAULT 1,
  first_seen_run UUID REFERENCES security_audit_runs(id),
  last_seen_run  UUID REFERENCES security_audit_runs(id),
  resolved_run   UUID REFERENCES security_audit_runs(id),
  incident_id    UUID REFERENCES security_incidents(id),
  opened_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at   TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sa_findings_status_idx ON security_audit_findings(status);
CREATE INDEX IF NOT EXISTS sa_runs_started_idx ON security_audit_runs(started_at DESC);
