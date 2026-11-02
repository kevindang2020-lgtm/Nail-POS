-- 716_product_usage_ledger.sql — Stock Alerts + Technician Product Usage mandate (Oct 29 2026). EXPAND-ONLY, idempotent.
--
-- A technician product-usage EVENT is a confirmed consumption of tracked stock by an identified technician. Stock itself
-- stays where it has always been — the bottle rows (inventory_units) from which inventory_location_stock is recomputed —
-- so this ledger never becomes a second stock count: every event consumes from real bottles (their remaining fraction,
-- an unopened bottle being 100 %), in ONE transaction with exactly ONE inventory_stock_movements row (unique below).
-- Quantities are integer HUNDREDTHS of the product's base unit (0.5 bottle = 50): exact, no floating point.
CREATE TABLE IF NOT EXISTS product_usage_events (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL,
  branch_id             uuid NOT NULL,
  product_id            uuid NOT NULL,
  technician_id         uuid NOT NULL,              -- the person who actually used it (technicians.id, stable across renames)
  quantity_hundredths   integer NOT NULL CHECK (quantity_hundredths > 0),
  unit                  text NOT NULL,              -- the product's base unit at the time (bottle / piece / …)
  occurred_at           timestamptz NOT NULL,       -- when it was used (the "Last Used By" clock)
  created_at            timestamptz NOT NULL DEFAULT now(),   -- when it was recorded (Page 1 order)
  created_by_user_id    uuid,                       -- who recorded it (may differ from the technician)
  source                text NOT NULL CHECK (source IN ('front_desk', 'technician_app', 'scan', 'manager', 'correction')),
  status                text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'reversed')),
  service_ticket_id     uuid,
  inventory_unit_id     uuid,                       -- the bottle asked for, when one was chosen
  note                  text,
  on_behalf_reason      text,                       -- why a manager recorded someone else's use
  idempotency_key       text,
  correlation_id        uuid NOT NULL DEFAULT gen_random_uuid(),
  consumed_json         jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{unitId, takenHundredths, fromStatus, toStatus, remainingBefore}]
  short_hundredths      integer NOT NULL DEFAULT 0,           -- consumed beyond stock (only where the product allows negative stock)
  stock_before_hundredths integer NOT NULL,                   -- Σ remaining across usable bottles, before / after
  stock_after_hundredths  integer NOT NULL,
  bottles_before        integer NOT NULL,
  bottles_after         integer NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_product_usage_events_idem ON product_usage_events (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_product_usage_last_use ON product_usage_events (tenant_id, branch_id, product_id, occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_product_usage_created ON product_usage_events (tenant_id, branch_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_product_usage_technician ON product_usage_events (tenant_id, technician_id, occurred_at DESC);

-- Corrections never edit a confirmed event: a signed delta (negative = given back to the bottles it came from, positive =
-- more was used) with the reason, the actor and the stock effect. Effective quantity = event quantity + Σ deltas.
CREATE TABLE IF NOT EXISTS product_usage_adjustments (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL,
  branch_id             uuid NOT NULL,
  usage_event_id        uuid NOT NULL REFERENCES product_usage_events (id),
  delta_hundredths      integer NOT NULL CHECK (delta_hundredths <> 0),
  reason                text NOT NULL,
  actor_user_id         uuid,
  idempotency_key       text,
  restored_json         jsonb NOT NULL DEFAULT '[]'::jsonb,
  stock_before_hundredths integer NOT NULL,
  stock_after_hundredths  integer NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_product_usage_adj_idem ON product_usage_adjustments (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_product_usage_adj_event ON product_usage_adjustments (tenant_id, usage_event_id, created_at);

-- Exactly ONE stock movement per usage event / adjustment: a retried or replayed submission cannot move stock twice.
CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_movements_usage_source ON inventory_stock_movements (tenant_id, related_type, related_id)
  WHERE related_type IN ('product_usage_event', 'product_usage_adjustment');
-- Stock Alerts lists / history (movements already have idx_inv_moves_scope)
CREATE INDEX IF NOT EXISTS idx_inventory_alerts_tenant_created ON inventory_alerts (tenant_id, branch_id, created_at DESC, id DESC);
