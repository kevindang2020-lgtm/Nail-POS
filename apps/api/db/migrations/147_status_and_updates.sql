-- 135_status_and_updates.sql
-- Platform-wide System Status + Recent Product Updates (spec §7-status, §43-updates). These are platform-managed,
-- read-only to tenants (not tenant-scoped content). The overall status the Help Center shows is still gated by a
-- real DB health probe; these tables add component-level detail, incident history, and a release-notes feed. No
-- rows seeded — the Help Center renders honest "operational / no incidents / no updates yet" states until the
-- platform publishes content.

CREATE TABLE IF NOT EXISTS status_components (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key         TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'operational'
              CHECK (status IN ('operational','degraded','partial_outage','major_outage','maintenance')),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS status_incidents (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title        TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'investigating'
               CHECK (status IN ('investigating','identified','monitoring','resolved')),
  impact       TEXT NOT NULL DEFAULT 'minor' CHECK (impact IN ('none','minor','major','critical')),
  body         TEXT,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_status_incidents_started ON status_incidents (started_at DESC);

CREATE TABLE IF NOT EXISTS product_updates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version       TEXT,
  title         TEXT NOT NULL,
  category      TEXT CHECK (category IN ('feature','improvement','fix','announcement')),
  body          TEXT,
  published_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_product_updates_published ON product_updates (published_at DESC);
