-- 182_campaign_templates.sql
-- Reusable campaign templates created by Super Admin and distributed to tenants. Tenants copy a template, customize
-- permitted fields, pick their OWN eligible audience + schedule, and send through their own tenant workflow — the
-- template never overwrites a tenant's customized campaign. Template edits use versioning (new version row; prior
-- versions preserved). Distinct from platform announcements and tenant campaigns.
CREATE TABLE IF NOT EXISTS campaign_templates (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name               TEXT NOT NULL,
  campaign_type      TEXT NOT NULL DEFAULT 'promotional',
  channel            TEXT NOT NULL DEFAULT 'email' CHECK (channel IN ('email','sms','push','in_app','multi')),
  subject            TEXT,
  body               TEXT,
  sms_content        TEXT,
  push_title         TEXT,
  push_content       TEXT,
  suggested_audience TEXT,
  suggested_offer    TEXT,
  compliance_note    TEXT,
  status             TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  current_version    INTEGER NOT NULL DEFAULT 1,
  created_by_user_id UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS campaign_template_versions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id        UUID NOT NULL REFERENCES campaign_templates(id) ON DELETE CASCADE,
  version            INTEGER NOT NULL,
  subject            TEXT,
  body               TEXT,
  channel            TEXT,
  notes              TEXT,
  published          BOOLEAN NOT NULL DEFAULT false,
  created_by_user_id UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (version >= 1)
);

-- One row per (template, version) — a version is immutable once created (new edits bump the version).
CREATE UNIQUE INDEX IF NOT EXISTS ux_template_version ON campaign_template_versions (template_id, version);
CREATE INDEX IF NOT EXISTS ix_templates_status  ON campaign_templates (status);
CREATE INDEX IF NOT EXISTS ix_template_versions_template ON campaign_template_versions (template_id);
