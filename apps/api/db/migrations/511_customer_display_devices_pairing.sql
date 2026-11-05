-- 511_customer_display_devices_pairing.sql — 23-inch dual-screen spec §8–§12, §81–§86, §97 (Unit 6).
--
-- 1. POS registers (§9–§10). `customer_display_devices.pos_station_id` existed with nothing to point at: no table of
--    registers, so "dedicated" pairing could not be expressed and Send to Display matched the ticket's free-text work
--    station against a UUID (never equal). A register is a named POS station in a branch; a display whose
--    pos_station_id is set is DEDICATED to it, a display without one is SHARED by the branch.
CREATE TABLE IF NOT EXISTS pos_stations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL,
  branch_id   UUID NOT NULL,
  name        TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 40),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  retired_at  TIMESTAMPTZ,
  CONSTRAINT fk_pos_stations_branch FOREIGN KEY (tenant_id, branch_id) REFERENCES branches (tenant_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_pos_stations_tenant_id ON pos_stations (tenant_id, id);
-- one live register per name in a branch (a retired name can be reused)
CREATE UNIQUE INDEX IF NOT EXISTS ux_pos_stations_live_name ON pos_stations (tenant_id, branch_id, lower(btrim(name))) WHERE retired_at IS NULL;

-- 2. Display-initiated pairing (§8, §12). The display asks for a code and shows it; staff type it into the POS, which
--    binds a NEW display row to the salon and branch of the person signed in (the display never chooses them). The
--    display collects its device token with the secret only it holds; the token is minted at that moment, so no
--    credential is ever stored here. Codes live 10 minutes; an open code is unique. `platform` is what the display
--    runs on (the Android / iOS app, or a browser on a second monitor) — the device's type in the POS.
CREATE TABLE IF NOT EXISTS customer_display_pairings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash         TEXT NOT NULL CHECK (char_length(code_hash) = 64),
  poll_secret_hash  TEXT NOT NULL CHECK (char_length(poll_secret_hash) = 64),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at        TIMESTAMPTZ NOT NULL,
  tenant_id         UUID,
  device_id         UUID,
  claimed_at        TIMESTAMPTZ,
  consumed_at       TIMESTAMPTZ,
  platform          TEXT CHECK (platform IS NULL OR platform IN ('android', 'ios', 'web')),
  CONSTRAINT ck_display_pairing_claim CHECK ((tenant_id IS NULL) = (device_id IS NULL) AND (device_id IS NULL) = (claimed_at IS NULL)),
  CONSTRAINT ck_display_pairing_consumed CHECK (consumed_at IS NULL OR claimed_at IS NOT NULL),
  CONSTRAINT fk_display_pairing_device FOREIGN KEY (tenant_id, device_id) REFERENCES customer_display_devices (tenant_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_display_pairing_open_code ON customer_display_pairings (code_hash) WHERE claimed_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_display_pairing_expires ON customer_display_pairings (expires_at);

-- 3. What the display reports about itself (§85–§86): its mode, app version, screen and profile — sent with its
--    heartbeat — and the owner's MAINTENANCE switch. Connection status is derived from last_seen_at.
ALTER TABLE customer_display_devices
  ADD COLUMN IF NOT EXISTS reported_mode   TEXT,
  ADD COLUMN IF NOT EXISTS app_version     TEXT,
  ADD COLUMN IF NOT EXISTS screen_width    INTEGER,
  ADD COLUMN IF NOT EXISTS screen_height   INTEGER,
  ADD COLUMN IF NOT EXISTS pixel_ratio     NUMERIC(4,2),
  ADD COLUMN IF NOT EXISTS display_profile TEXT,
  ADD COLUMN IF NOT EXISTS maintenance_at  TIMESTAMPTZ;
DO $$ BEGIN
  ALTER TABLE customer_display_devices ADD CONSTRAINT ck_cdd_reported_mode CHECK (reported_mode IS NULL OR reported_mode IN ('check_in', 'checkout', 'advertisement', 'idle'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE customer_display_devices ADD CONSTRAINT ck_cdd_app_version CHECK (app_version IS NULL OR char_length(app_version) BETWEEN 1 AND 40);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE customer_display_devices ADD CONSTRAINT ck_cdd_screen CHECK ((screen_width IS NULL OR screen_width BETWEEN 100 AND 10000) AND (screen_height IS NULL OR screen_height BETWEEN 100 AND 10000) AND (pixel_ratio IS NULL OR (pixel_ratio >= 0.5 AND pixel_ratio <= 8)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE customer_display_devices ADD CONSTRAINT ck_cdd_profile CHECK (display_profile IS NULL OR display_profile IN ('CUSTOMER_DISPLAY_23_LANDSCAPE', 'LANDSCAPE', 'PORTRAIT_TABLET'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3b. A display's register is a real register of its salon. Before this migration `pos_station_id` could hold any
--    UUID-shaped string (the old settings pairing took whatever was typed) and pointed at nothing — there was no table
--    of registers — so no value in it can be a register; it is cleared once, then the foreign key keeps it honest. A
--    register's row is never deleted (it is retired); if its branch is deleted the display simply becomes shared.
UPDATE customer_display_devices d SET pos_station_id = NULL
 WHERE d.pos_station_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM pos_stations s WHERE s.tenant_id = d.tenant_id AND s.id = d.pos_station_id);
DO $$ BEGIN
  ALTER TABLE customer_display_devices ADD CONSTRAINT fk_cdd_pos_station
    FOREIGN KEY (tenant_id, pos_station_id) REFERENCES pos_stations (tenant_id, id) ON DELETE SET NULL (pos_station_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 4. The receipt step (§97–§98): what the customer chose on the display, and what happened. The 3-second completed
--    screen — and the release that ends the checkout — wait for it. 'sending' marks a choice being delivered (one
--    delivery per checkout: a second tap finds the choice already taken).
ALTER TABLE customer_display_sessions
  ADD COLUMN IF NOT EXISTS receipt_choice TEXT,
  ADD COLUMN IF NOT EXISTS receipt_status TEXT,
  ADD COLUMN IF NOT EXISTS receipt_at     TIMESTAMPTZ;
DO $$ BEGIN
  ALTER TABLE customer_display_sessions ADD CONSTRAINT ck_cds_receipt CHECK (
    (receipt_choice IS NULL OR receipt_choice IN ('sms', 'email', 'none'))
    AND (receipt_status IS NULL OR receipt_status IN ('sending', 'sent', 'skipped', 'unavailable', 'failed'))
    AND ((receipt_choice IS NULL) = (receipt_status IS NULL)) AND ((receipt_choice IS NULL) = (receipt_at IS NULL)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
