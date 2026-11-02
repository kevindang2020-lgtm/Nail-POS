-- 106_tenant_location_management.sql — Salon Location & Nearby Discovery (tenant manager side).
-- EXTENDS the canonical `branches` record (do NOT create a second locations table). Adds map-pin
-- verification, per-branch publish flags, public profile fields, hours, and map-change history.
-- Customer discovery (customer-salons module) continues to read `branches` + `tenant_app_flags`.

-- ---- branch (location) management columns — all additive / idempotent --------------------------
ALTER TABLE branches ADD COLUMN IF NOT EXISTS salon_code           TEXT;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS public_display_name  TEXT;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS description          TEXT;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS public_email         TEXT;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS website              TEXT;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS address_line2        TEXT;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS suite_unit           TEXT;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS country_code         TEXT DEFAULT 'US';
ALTER TABLE branches ADD COLUMN IF NOT EXISTS formatted_address    TEXT;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS google_place_id      TEXT;
-- map_accuracy ∈ exact | rooftop | approximate | manually_adjusted | needs_confirmation | rejected
ALTER TABLE branches ADD COLUMN IF NOT EXISTS map_accuracy         TEXT;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS map_pin_confirmed_at TIMESTAMPTZ;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS map_pin_confirmed_by UUID;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS timezone             TEXT;
-- verification_status ∈ draft | manager_confirmed | pending_review | verified | rejected | suspended | unpublished
ALTER TABLE branches ADD COLUMN IF NOT EXISTS verification_status  TEXT NOT NULL DEFAULT 'draft';
-- is_public: NULL on pre-existing rows (kept visible via tenant public_listing flag for back-compat);
-- explicitly FALSE hides a branch from discovery even if the tenant flag is on.
ALTER TABLE branches ADD COLUMN IF NOT EXISTS is_public            BOOLEAN;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS is_online_booking_enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS accepts_walk_ins     BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS show_phone_publicly  BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS show_address_publicly BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS show_prices_publicly BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS booking_lead_minutes INT;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS published_at         TIMESTAMPTZ;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS unpublished_at       TIMESTAMPTZ;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS verified_at          TIMESTAMPTZ;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS verified_by          UUID;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS manager_name         TEXT;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS manager_phone        TEXT;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS manager_email        TEXT;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS internal_notes       TEXT;   -- NEVER returned to customers
ALTER TABLE branches ADD COLUMN IF NOT EXISTS deleted_at           TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_branches_coords       ON branches (latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_branches_verification ON branches (verification_status);
CREATE INDEX IF NOT EXISTS idx_branches_public       ON branches (is_public);

-- ---- per-branch business hours --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenant_location_hours (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL,
  location_id    UUID NOT NULL,
  day_of_week    INT  NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),  -- 0=Sun
  opens_at       TEXT,                                              -- 'HH:MM' (branch-local)
  closes_at      TEXT,
  is_closed      BOOLEAN NOT NULL DEFAULT false,
  effective_from DATE,
  effective_to   DATE,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (location_id, day_of_week)
);
CREATE INDEX IF NOT EXISTS idx_location_hours_loc ON tenant_location_hours (tenant_id, location_id);

-- ---- map-change history (audit trail of pin/address moves) ----------------------------------
CREATE TABLE IF NOT EXISTS tenant_location_map_history (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL,
  location_id        UUID NOT NULL,
  previous_latitude  DOUBLE PRECISION,
  previous_longitude DOUBLE PRECISION,
  new_latitude       DOUBLE PRECISION,
  new_longitude      DOUBLE PRECISION,
  previous_address   TEXT,
  new_address        TEXT,
  changed_by         UUID,
  change_source      TEXT,    -- geocode | manual_drag | reverse_geocode | super_admin
  change_reason      TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_location_map_history_loc ON tenant_location_map_history (tenant_id, location_id, created_at DESC);
