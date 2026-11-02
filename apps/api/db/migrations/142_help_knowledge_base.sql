-- 130_help_knowledge_base.sql
-- Help Center knowledge base (spec §15–16, §36). Articles and their taxonomy are PLATFORM-GLOBAL product help
-- content (not tenant-authored), with applicability fields so a tenant only sees articles relevant to its role /
-- plan / platform. Article edits must never silently overwrite a published version — every change is snapshotted
-- into help_article_versions (spec §16). Per-reader signals (helpful feedback) are tenant/user scoped and never
-- cross tenants (spec §38). No rows are seeded here: the Help Center honestly shows empty states until content is
-- authored, rather than shipping invented articles.

CREATE TABLE IF NOT EXISTS help_categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        TEXT NOT NULL UNIQUE,
  label       TEXT NOT NULL,
  description TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS help_articles (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id      UUID REFERENCES help_categories(id),
  slug             TEXT NOT NULL UNIQUE,
  title            TEXT NOT NULL,
  summary          TEXT,
  body             TEXT,
  status           TEXT NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','in_review','published','scheduled','outdated','archived')),
  roles            TEXT[] NOT NULL DEFAULT '{}',   -- empty = visible to all roles
  plans            TEXT[] NOT NULL DEFAULT '{}',   -- empty = visible on all plans
  platforms        TEXT[] NOT NULL DEFAULT '{}',   -- empty = visible on all platforms
  app_version      TEXT,
  author           TEXT,
  reviewer         TEXT,
  reading_minutes  INTEGER NOT NULL DEFAULT 0,
  view_count       BIGINT  NOT NULL DEFAULT 0,
  last_reviewed_at TIMESTAMPTZ,
  last_updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_help_articles_category ON help_articles (category_id);
CREATE INDEX IF NOT EXISTS idx_help_articles_status_views ON help_articles (status, view_count DESC);

-- Version history: a new row per published change so content is never silently overwritten (spec §16).
CREATE TABLE IF NOT EXISTS help_article_versions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id  UUID NOT NULL REFERENCES help_articles(id) ON DELETE CASCADE,
  version     INTEGER NOT NULL,
  title       TEXT NOT NULL,
  summary     TEXT,
  body        TEXT,
  status      TEXT,
  changed_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (article_id, version)
);

-- "Was this helpful" feedback — tenant/user scoped, never cross-tenant (spec §38).
CREATE TABLE IF NOT EXISTS help_article_feedback (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id  UUID NOT NULL REFERENCES help_articles(id) ON DELETE CASCADE,
  tenant_id   UUID NOT NULL,
  user_id     UUID,
  helpful     BOOLEAN NOT NULL,
  comment     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_help_feedback_article ON help_article_feedback (article_id);
CREATE INDEX IF NOT EXISTS idx_help_feedback_tenant  ON help_article_feedback (tenant_id, created_at DESC);
