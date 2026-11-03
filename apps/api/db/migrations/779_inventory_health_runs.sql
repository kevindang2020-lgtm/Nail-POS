-- 779_inventory_health_runs.sql — AI Inventory Assistant guides (Nov 2 2026, built Nov 3 2026). Additive only.
-- Rollback: DROP TABLE inventory_health_runs.
-- Products, stock, movements and purchase orders stay where they are; the assistant only reads them. This adds the evidence
-- table for the read-only "Check Inventory System" (each run's overall state and checks, so "last passed" is a fact).
CREATE TABLE IF NOT EXISTS inventory_health_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  branch_id     UUID,
  actor_user_id UUID,
  overall       TEXT NOT NULL CHECK (overall IN ('PASSED', 'WARNING', 'FAILED', 'INSUFFICIENT_DATA')),
  checks        JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_inventory_health_recent ON inventory_health_runs (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_inventory_movements_recent ON inventory_stock_movements (tenant_id, branch_id, created_at DESC);
