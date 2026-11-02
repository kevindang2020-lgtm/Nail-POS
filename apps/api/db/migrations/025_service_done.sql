-- 025_service_done.sql — POS Service Done workflow state on completed tickets (tenant-scoped).
-- The service-done stage reuses the tickets produced by Serving; these columns track review/quality/checkout flow.
ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS service_done_quality_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (service_done_quality_status IN ('pending','approved','issue_found','needs_review')),
  ADD COLUMN IF NOT EXISTS service_done_checkout_status TEXT NOT NULL DEFAULT 'not_ready'
    CHECK (service_done_checkout_status IN ('not_ready','ready_for_checkout','sent_to_checkout','reopened')),
  ADD COLUMN IF NOT EXISTS service_done_notes TEXT,
  ADD COLUMN IF NOT EXISTS service_done_customer_visible_notes TEXT,
  ADD COLUMN IF NOT EXISTS service_done_customer_notified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS service_done_send_idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS helper_technician_id UUID REFERENCES technicians(id);

-- [moved] orphaned index on non-existent 'pos_tickets' removed; canonical table is indexed by its own migration.

-- Idempotent send-to-checkout: one transfer key per ticket so retries never duplicate a checkout ticket.
-- [moved] orphaned index on non-existent 'pos_tickets' removed; canonical table is indexed by its own migration.

CREATE TABLE IF NOT EXISTS pos_service_done_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  branch_id UUID,
  user_id UUID NOT NULL,
  role TEXT NOT NULL,
  action_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  before JSONB,
  after JSONB,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pos_service_done_audit_tenant ON pos_service_done_audit (tenant_id, created_at DESC);
