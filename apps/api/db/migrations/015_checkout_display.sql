-- 015_checkout_display.sql — AIPowerSalon dual-screen checkout. Idempotent.
-- Reuses tickets / ticket_service_lines / payments / receipts from earlier migrations.
-- Adds paired customer-display devices + sessions and tenant checkout settings.

CREATE TABLE IF NOT EXISTS customer_display_devices (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL,
  branch_id          UUID NOT NULL,
  pos_station_id     UUID,
  device_name        TEXT,
  device_type        TEXT NOT NULL DEFAULT 'ipad_mini',
  pairing_code_hash  TEXT,
  pairing_status     TEXT NOT NULL DEFAULT 'pending',
  last_seen_at       TIMESTAMPTZ,
  revoked_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS customer_display_sessions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL,
  branch_id          UUID NOT NULL,
  display_device_id  UUID,
  pos_station_id     UUID,
  ticket_id          UUID,
  customer_id        UUID,
  state              TEXT NOT NULL DEFAULT 'idle',
  public_token_hash  TEXT NOT NULL,
  selected_tip_cents INTEGER NOT NULL DEFAULT 0,
  subtotal_cents     INTEGER NOT NULL DEFAULT 0,
  surcharge_cents    INTEGER NOT NULL DEFAULT 0,
  tax_cents          INTEGER NOT NULL DEFAULT 0,
  total_due_cents    INTEGER NOT NULL DEFAULT 0,
  payment_method     TEXT,
  expires_at         TIMESTAMPTZ,
  closed_at          TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS checkout_settings (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                     UUID NOT NULL,
  branch_id                     UUID NOT NULL,
  credit_card_surcharge_enabled BOOLEAN NOT NULL DEFAULT true,
  credit_card_surcharge_percent NUMERIC(5,2) NOT NULL DEFAULT 3.00,
  surcharge_label               TEXT NOT NULL DEFAULT 'Card Surcharge',
  tax_rate_percent              NUMERIC(5,2) NOT NULL DEFAULT 7.75,
  cash_discount_enabled         BOOLEAN NOT NULL DEFAULT false,
  default_tip_percents_json     TEXT NOT NULL DEFAULT '[15,18,20]',
  customer_display_pay_button_enabled BOOLEAN NOT NULL DEFAULT false,
  max_tip_percent               NUMERIC(5,2) NOT NULL DEFAULT 100.00,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, branch_id)
);

-- ensure payment money columns exist (no-op if already present)
ALTER TABLE payments ADD COLUMN IF NOT EXISTS tip_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS surcharge_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS tax_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS processor TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS processor_reference_id TEXT;

CREATE INDEX IF NOT EXISTS idx_display_devices_tenant_branch_station
  ON customer_display_devices (tenant_id, branch_id, pos_station_id);
CREATE INDEX IF NOT EXISTS idx_display_sessions_device_state
  ON customer_display_sessions (display_device_id, state);
CREATE INDEX IF NOT EXISTS idx_display_sessions_tenant_branch_ticket
  ON customer_display_sessions (tenant_id, branch_id, ticket_id);
CREATE INDEX IF NOT EXISTS idx_checkout_settings_tenant_branch
  ON checkout_settings (tenant_id, branch_id);
