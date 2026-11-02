-- 017a_pos_settings_integrations.sql  (renamed from 017_pos_settings_integrations.sql to resolve the 017 number collision; SQL unchanged, idempotent)
-- Persistence for the POS Settings provider/hardware integration layer. Tenant-scoped.
-- (The shipped adapters are in-memory; these tables back the real Postgres/Kysely adapters.)

CREATE TABLE IF NOT EXISTS pos_payment_terminals (
  id           TEXT NOT NULL,
  tenant_id    TEXT NOT NULL,
  branch_id    TEXT,
  label        TEXT NOT NULL,
  station_id   TEXT,
  status       TEXT NOT NULL DEFAULT 'unpaired',
  paired_at    TIMESTAMPTZ,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS pos_display_devices (
  id           TEXT NOT NULL,
  tenant_id    TEXT NOT NULL,
  branch_id    TEXT,
  name         TEXT NOT NULL,
  station_id   TEXT,
  status       TEXT NOT NULL DEFAULT 'unpaired',
  last_seen_at TIMESTAMPTZ,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS pos_message_templates (
  id          TEXT NOT NULL,
  tenant_id   TEXT NOT NULL,
  channel     TEXT NOT NULL,
  name        TEXT NOT NULL,
  body        TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS pos_booking_integrations (
  tenant_id               TEXT PRIMARY KEY,
  online_booking_enabled  BOOLEAN NOT NULL DEFAULT true,
  tenant_slug             TEXT,
  google_reserve_connected BOOLEAN NOT NULL DEFAULT false,
  google_booking_link     TEXT,
  ai_phone_enabled        BOOLEAN NOT NULL DEFAULT false,
  ai_actions              JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS pos_messaging_sender (
  tenant_id    TEXT PRIMARY KEY,
  sender_brand TEXT,
  a2p_status   TEXT NOT NULL DEFAULT 'not_registered'
);

CREATE INDEX IF NOT EXISTS idx_terminals_tenant ON pos_payment_terminals (tenant_id);
CREATE INDEX IF NOT EXISTS idx_devices_tenant   ON pos_display_devices (tenant_id);
