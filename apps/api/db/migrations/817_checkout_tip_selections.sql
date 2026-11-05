-- 817_checkout_tip_selections.sql — Individual Technician Tipping at Checkout (Split Tips guide, Nov 5 2026, G4).
--
-- The customer taps each technician who performed services on the customer display, picks a separate tip for each,
-- reviews and confirms BEFORE the card payment. AI PowerSalon keeps the per-technician allocation (Fiserv gets one
-- combined amount). Reuses the ONE tip store, ticket_tip_allocations (052): an explicit allocation already governs the
-- payment-time compensation snapshot ("customer_directed" — never replaced by the 50/50 or proportional fallback).
--
-- checkout_tip_selections  one versioned selection per ticket: DRAFT → CONFIRMED (the customer confirmed on the
--                          display) → LOCKED (payment started) ; SUPERSEDED when the front desk changed the total tip or
--                          the performers changed. recipients_key fingerprints the eligible performers + their service
--                          basis at selection time — a changed performer makes the selection stale (reconfirm).
-- checkout_tip_selection_events  append-only history (draft, per-technician change, confirm, lock, superseded).
-- ticket_tip_allocations.source  who wrote the row: 'legacy' (every existing row — unchanged), 'customer_display', 'staff'.

ALTER TABLE ticket_tip_allocations ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'legacy';
ALTER TABLE ticket_tip_allocations ADD COLUMN IF NOT EXISTS selection_version integer;
ALTER TABLE ticket_tip_allocations DROP CONSTRAINT IF EXISTS chk_tta_source;
ALTER TABLE ticket_tip_allocations ADD CONSTRAINT chk_tta_source CHECK (source IN ('legacy', 'customer_display', 'staff'));

CREATE TABLE IF NOT EXISTS checkout_tip_selections (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  branch_id        uuid,
  ticket_id        uuid NOT NULL,
  version          integer NOT NULL DEFAULT 1,
  state            text NOT NULL DEFAULT 'DRAFT',
  recipients_key   text NOT NULL,
  selections       jsonb NOT NULL DEFAULT '[]'::jsonb,
  total_tip_cents  integer NOT NULL DEFAULT 0,
  source           text NOT NULL DEFAULT 'customer_display',
  session_id       uuid,
  confirmed_at     timestamptz,
  locked_at        timestamptz,
  superseded_reason text,
  updated_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_cts_state CHECK (state IN ('DRAFT', 'CONFIRMED', 'LOCKED', 'SUPERSEDED')),
  CONSTRAINT chk_cts_source CHECK (source IN ('customer_display', 'staff')),
  CONSTRAINT chk_cts_total CHECK (total_tip_cents >= 0),
  CONSTRAINT chk_cts_json CHECK (jsonb_typeof(selections) = 'array'),
  CONSTRAINT uq_cts_ticket UNIQUE (tenant_id, ticket_id)
);

CREATE TABLE IF NOT EXISTS checkout_tip_selection_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  ticket_id        uuid NOT NULL,
  version          integer NOT NULL,
  action           text NOT NULL,
  detail           jsonb NOT NULL DEFAULT '{}'::jsonb,
  session_id       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_ctse_action CHECK (action IN ('DRAFT_SAVED', 'CONFIRMED', 'LOCKED', 'SUPERSEDED'))
);
CREATE INDEX IF NOT EXISTS ix_ctse_ticket ON checkout_tip_selection_events (tenant_id, ticket_id, created_at);

CREATE OR REPLACE FUNCTION ctse_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'checkout_tip_selection_events is append-only' USING ERRCODE = 'P0001'; END $$;
DROP TRIGGER IF EXISTS trg_ctse_append_only ON checkout_tip_selection_events;
CREATE TRIGGER trg_ctse_append_only BEFORE UPDATE OR DELETE ON checkout_tip_selection_events FOR EACH ROW EXECUTE FUNCTION ctse_append_only();
