-- 179_platform_announcements.sql
-- Platform-owned campaigns (announcements) for Super Admin › Marketing & Campaigns. These are DISTINCT from tenant
-- customer campaigns (table `campaigns`): a platform announcement targets tenant USERS of selected tenants (or all
-- tenants), never a tenant's own customers. Kept in a separate table to preserve the platform/tenant boundary.
-- Money is integer cents. Delivery metrics stay zero until a real delivery pipeline exists (surfaced as NotConnected).
CREATE TABLE IF NOT EXISTS platform_announcements (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title              TEXT NOT NULL,
  body               TEXT,
  channel            TEXT NOT NULL DEFAULT 'email'   CHECK (channel IN ('email','sms','push','in_app')),
  audience_scope     TEXT NOT NULL DEFAULT 'selected_tenants' CHECK (audience_scope IN ('all_tenants','selected_tenants')),
  status             TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','scheduled','sending','sent','cancelled')),
  scheduled_at       TIMESTAMPTZ,
  audience_size      INTEGER NOT NULL DEFAULT 0,
  sent_count         INTEGER NOT NULL DEFAULT 0,
  open_count         INTEGER NOT NULL DEFAULT 0,
  click_count        INTEGER NOT NULL DEFAULT 0,
  booking_count      INTEGER NOT NULL DEFAULT 0,
  revenue_cents      BIGINT  NOT NULL DEFAULT 0,
  template_id        UUID,
  created_by_user_id UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  scheduled_by_user_id UUID,
  sent_at            TIMESTAMPTZ,
  cancelled_at       TIMESTAMPTZ,
  cancel_reason      TEXT,
  CHECK (audience_size >= 0 AND sent_count >= 0 AND open_count >= 0 AND click_count >= 0 AND booking_count >= 0)
);

CREATE TABLE IF NOT EXISTS platform_announcement_targets (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  announcement_id  UUID NOT NULL REFERENCES platform_announcements(id) ON DELETE CASCADE,
  tenant_id        UUID NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A tenant appears at most once per announcement.
CREATE UNIQUE INDEX IF NOT EXISTS ux_announcement_target ON platform_announcement_targets (announcement_id, tenant_id);
CREATE INDEX IF NOT EXISTS ix_announcements_status  ON platform_announcements (status);
CREATE INDEX IF NOT EXISTS ix_announcements_created ON platform_announcements (created_at DESC);
CREATE INDEX IF NOT EXISTS ix_announcement_targets_tenant ON platform_announcement_targets (tenant_id);
