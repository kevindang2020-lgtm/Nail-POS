-- 990_walkin_service_selection.sql — CPad 14 Walk-In service selection (SUNMI guide Section 4A, extras round 12).
-- Additive only. Two parts:
--
-- 1. Owner switches (4A.9) on the salon's EXISTING check-in settings row (tenant_checkin_settings — the POS
--    Devices → Customer Displays settings card edits it). "Enable Walk-In service selection" is the existing
--    service_selection_enabled (ON). New, all ON by default, exactly the guide's defaults:
--      walkin_require_services   ON  — OFF lets a guest skip to "Services pending" (front-desk assistance)
--      walkin_show_prices        ON  — the public catalog price, labelled "estimated"
--      walkin_show_durations     ON  — a missing duration is never shown
--      walkin_allow_add_ons      ON  — the salon's "Add-ons" category services (the D1 add-on authority)
--    "Allow technician preference" is the existing technician_preference_enabled: the guide says OFF until assignment
--    rules are verified, so its DEFAULT becomes false. Existing rows keep the value their owner saved (no UPDATE here).
--
-- 2. walkin_service_requests — one row per guest's confirmed walk-in request from a display / kiosk (4A.5, 4A.7): the
--    selected lines as the server re-priced them, the catalog revision the guest approved, and the visit / queue entry
--    it produced. Unique per (tenant, branch, authenticated device, checkin_request_id): a double tap, a network retry or
--    a restored session with the same id finds THIS row and returns the same result; the same id with a different
--    payload is refused by the service (IDEMPOTENCY_KEY_REUSED). It is a request record only — never a ticket, a
--    charge or a points movement. No customer phone or name is stored here (they live on the visit, as before).
--
-- Rollback: DROP TABLE walkin_service_requests; ALTER TABLE tenant_checkin_settings DROP COLUMN walkin_require_services,
--           DROP COLUMN walkin_show_prices, DROP COLUMN walkin_show_durations, DROP COLUMN walkin_allow_add_ons;
--           ALTER TABLE tenant_checkin_settings ALTER COLUMN technician_preference_enabled SET DEFAULT true;
--           (or switch the flow off: service_selection_enabled = false restores the plain walk-in for that salon)
ALTER TABLE tenant_checkin_settings ADD COLUMN IF NOT EXISTS walkin_require_services BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE tenant_checkin_settings ADD COLUMN IF NOT EXISTS walkin_show_prices BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE tenant_checkin_settings ADD COLUMN IF NOT EXISTS walkin_show_durations BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE tenant_checkin_settings ADD COLUMN IF NOT EXISTS walkin_allow_add_ons BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE tenant_checkin_settings ALTER COLUMN technician_preference_enabled SET DEFAULT false;

CREATE TABLE IF NOT EXISTS walkin_service_requests (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL REFERENCES tenants (id),
  branch_id              UUID NOT NULL REFERENCES branches (id),
  device_ref             TEXT NOT NULL CHECK (device_ref ~ '^(display|kiosk):[0-9a-fA-F-]{36}$'),
  checkin_request_id     TEXT NOT NULL CHECK (checkin_request_id ~ '^[A-Za-z0-9_-]{8,64}$'),
  payload_hash           TEXT NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  catalog_revision       TEXT NOT NULL CHECK (length(catalog_revision) BETWEEN 1 AND 128),
  lines                  JSONB NOT NULL DEFAULT '[]'::jsonb,
  services_pending       BOOLEAN NOT NULL DEFAULT false,
  estimated_total_cents  BIGINT NOT NULL DEFAULT 0 CHECK (estimated_total_cents >= 0),
  estimated_minutes      INTEGER NOT NULL DEFAULT 0 CHECK (estimated_minutes >= 0),
  status                 TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'queued', 'existing_visit', 'failed')),
  queue_item_id          UUID REFERENCES pos_queue_items (id),
  result                 JSONB,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_walkin_service_requests_key ON walkin_service_requests (tenant_id, branch_id, device_ref, checkin_request_id);
CREATE INDEX IF NOT EXISTS ix_walkin_service_requests_queue_item ON walkin_service_requests (tenant_id, queue_item_id) WHERE queue_item_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_tc_walkin_service_requests__branch_id ON walkin_service_requests;
CREATE TRIGGER trg_tc_walkin_service_requests__branch_id BEFORE INSERT OR UPDATE OF tenant_id, branch_id ON walkin_service_requests
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('branches', 'branch_id');
DROP TRIGGER IF EXISTS trg_tc_walkin_service_requests__queue_item_id ON walkin_service_requests;
CREATE TRIGGER trg_tc_walkin_service_requests__queue_item_id BEFORE INSERT OR UPDATE OF tenant_id, queue_item_id ON walkin_service_requests
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('pos_queue_items', 'queue_item_id');
