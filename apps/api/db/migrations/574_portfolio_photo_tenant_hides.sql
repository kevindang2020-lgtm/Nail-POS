-- 574_portfolio_photo_tenant_hides.sql — PER-TENANT portfolio moderation (Technician Profile package, their 456).
--
-- A portfolio photo belongs to the technician's GLOBAL profile, not to any salon. Until now a manager at one salon
-- could flip tech_portfolio_photos.moderation_status and hide the photo on every salon's page and on the technician's
-- own public profile — a global edit from a tenant-scoped authority. A salon may decide what appears on ITS surfaces,
-- never on everybody else's. This table records "tenant X does not show photo Y"; the global moderation_status is
-- reserved for the technician (publish/unpublish) and the Super Admin (platform policy).
CREATE TABLE IF NOT EXISTS tech_portfolio_photo_tenant_hides (
  photo_id          UUID NOT NULL REFERENCES tech_portfolio_photos(id) ON DELETE CASCADE,
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  hidden_by_user_id UUID,
  reason            TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (photo_id, tenant_id)
);
CREATE INDEX IF NOT EXISTS idx_tpp_tenant_hides_tenant ON tech_portfolio_photo_tenant_hides (tenant_id);
