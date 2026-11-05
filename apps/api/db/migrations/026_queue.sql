-- 026_queue.sql — POS Queue (waiting guests) tenant-scoped intake state.
CREATE TABLE IF NOT EXISTS pos_queue_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  branch_id UUID,
  customer_id UUID,
  customer_name TEXT NOT NULL,
  customer_phone TEXT,
  is_vip BOOLEAN NOT NULL DEFAULT false,
  source TEXT NOT NULL DEFAULT 'walk_in'
    CHECK (source IN ('walk_in','appointment','online','google','ai','manual')),
  appointment_id UUID,
  ticket_id UUID,
  requested_services JSONB NOT NULL DEFAULT '[]'::jsonb,
  priority TEXT NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('normal','high','vip','urgent')),
  status TEXT NOT NULL DEFAULT 'waiting'
    CHECK (status IN ('waiting','called','assigned','ready_for_tech','moved_to_tech_queue','in_service','cancelled','removed')),
  assigned_technician_id UUID REFERENCES technicians(id),
  station TEXT,
  checked_in_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  called_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  notes TEXT,
  customer_notified_at TIMESTAMPTZ,
  serving_idempotency_key TEXT,
  tech_queue_idempotency_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pos_queue_items_tenant ON pos_queue_items (tenant_id, branch_id, status, checked_in_at);
-- Idempotent transfers: one key per item so retries never duplicate a Serving/Tech Queue ticket.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_queue_serving_key ON pos_queue_items (tenant_id, serving_idempotency_key) WHERE serving_idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_queue_techqueue_key ON pos_queue_items (tenant_id, tech_queue_idempotency_key) WHERE tech_queue_idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS pos_queue_audit (
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
CREATE INDEX IF NOT EXISTS idx_pos_queue_audit_tenant ON pos_queue_audit (tenant_id, created_at DESC);
