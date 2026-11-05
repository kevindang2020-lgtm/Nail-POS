-- 060_super_admin_platform.sql
-- The four Super Admin business modules the iPad-spec defines that had NO backing anywhere:
-- tenant applications (salons applying from the website), website leads, hardware package tracking (free iMac /
-- Clover Flex / check-in display offer), and audited support-access sessions. Platform-level tables: no tenant_id
-- scoping on applications/leads (they PRE-date a tenant); hardware + support sessions reference tenants.

CREATE TABLE IF NOT EXISTS tenant_applications (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_name         TEXT NOT NULL,
  owner_name         TEXT NOT NULL,
  phone              TEXT,
  email              TEXT,
  city               TEXT,
  state              TEXT,
  technicians_count  INTEGER,
  current_pos        TEXT,
  current_processor  TEXT,
  monthly_card_volume_cents BIGINT,
  preferred_imac_color TEXT,
  status             TEXT NOT NULL DEFAULT 'new'
                       CHECK (status IN ('new','reviewing','qualified','not_qualified','demo_scheduled','approved','converted','archived')),
  notes              JSONB NOT NULL DEFAULT '[]'::jsonb,
  converted_tenant_id UUID,
  source             TEXT,                          -- website page / campaign
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tenant_applications_status ON tenant_applications (status, created_at DESC);

CREATE TABLE IF NOT EXISTS website_leads (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        TEXT NOT NULL DEFAULT 'contact'
                CHECK (kind IN ('demo_request','contact','free_package','newsletter')),
  name        TEXT,
  salon_name  TEXT,
  phone       TEXT,
  email       TEXT,
  city        TEXT,
  state       TEXT,
  source_page TEXT,
  message     TEXT,
  status      TEXT NOT NULL DEFAULT 'new'
                CHECK (status IN ('new','contacted','demo_scheduled','converted_to_application','archived','spam')),
  notes       JSONB NOT NULL DEFAULT '[]'::jsonb,
  application_id UUID,                              -- set when converted to a tenant application
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_website_leads_kind_status ON website_leads (kind, status, created_at DESC);

CREATE TABLE IF NOT EXISTS hardware_packages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID,                               -- nullable until the application converts
  application_id UUID,
  imac_color    TEXT,
  imac_serial   TEXT,
  clover_flex_serial TEXT,
  checkin_display_serial TEXT,
  agreement_status TEXT NOT NULL DEFAULT 'pending' CHECK (agreement_status IN ('pending','sent','signed')),
  payment_setup_status TEXT NOT NULL DEFAULT 'pending' CHECK (payment_setup_status IN ('pending','in_progress','complete')),
  status        TEXT NOT NULL DEFAULT 'not_started'
                  CHECK (status IN ('not_started','pending_approval','ordered','ready','delivered','installed','activated','on_hold','cancelled')),
  delivered_at  TIMESTAMPTZ,
  activated_at  TIMESTAMPTZ,
  notes         JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hardware_packages_status ON hardware_packages (status, updated_at DESC);

CREATE TABLE IF NOT EXISTS support_access_sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL,
  admin_user_id UUID NOT NULL,
  admin_email TEXT,
  reason      TEXT NOT NULL,                        -- mandatory per spec
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,                 -- mandatory time limit per spec
  ended_at    TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_support_access_active ON support_access_sessions (tenant_id, expires_at DESC);
