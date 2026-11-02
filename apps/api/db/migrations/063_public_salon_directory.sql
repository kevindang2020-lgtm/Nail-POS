-- 063_public_salon_directory.sql — Customer App "Find Salons Near Me" (build doc §14–§18, §26).
-- Branch coordinates for distance search (no PostGIS dependency; haversine computed in the service tier).
ALTER TABLE branches ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;

-- Per-tenant app flags (§26 Super Admin controls), same explicit-override pattern as tenant_ai_features.
-- Semantics (documented): public_listing + show_on_map default OFF (tenants opt IN to public discovery);
-- customer_app_booking + technician_app + customer_service_progress + tech_live_ticket_edit default ON.
CREATE TABLE IF NOT EXISTS tenant_app_flags (
  tenant_id UUID NOT NULL,
  flag_key  TEXT NOT NULL CHECK (flag_key IN (
    'public_listing','show_on_map','customer_app_booking','technician_app','customer_service_progress','tech_live_ticket_edit'
  )),
  enabled   BOOLEAN NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, flag_key)
);
CREATE INDEX IF NOT EXISTS idx_tenant_app_flags_tenant ON tenant_app_flags (tenant_id);
