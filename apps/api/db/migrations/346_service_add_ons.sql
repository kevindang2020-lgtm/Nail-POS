-- 320_service_add_ons.sql — persistence for per-service add-ons (previously modeled + served by the
-- in-memory repo and API contract, but not persisted by the Postgres adapter). Completes the feature.
CREATE TABLE IF NOT EXISTS service_add_ons (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL,
  branch_id              UUID,
  service_id             UUID NOT NULL,
  add_on_key             TEXT NOT NULL,
  name                   TEXT NOT NULL,
  price_cents            BIGINT NOT NULL DEFAULT 0,
  duration_delta_minutes INTEGER NOT NULL DEFAULT 0,
  is_taxable             BOOLEAN NOT NULL DEFAULT true,
  is_active              BOOLEAN NOT NULL DEFAULT true,
  sort_order             INTEGER NOT NULL DEFAULT 0,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_service_add_ons_service ON service_add_ons (tenant_id, service_id);
