-- 027_tech_queue.sql — POS Tech Queue (technician-assigned tickets) tenant-scoped acceptance state.
CREATE TABLE IF NOT EXISTS pos_tech_queue_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  branch_id UUID,
  queue_item_id UUID REFERENCES pos_queue_items(id),
  ticket_id UUID,
  customer_id UUID,
  customer_name TEXT NOT NULL,
  customer_phone TEXT,
  is_vip BOOLEAN NOT NULL DEFAULT false,
  source TEXT NOT NULL DEFAULT 'walk_in'
    CHECK (source IN ('walk_in','appointment','online','google','ai','manual')),
  appointment_id UUID,
  requested_services JSONB NOT NULL DEFAULT '[]'::jsonb,
  priority TEXT NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('normal','high','vip','urgent')),
  status TEXT NOT NULL DEFAULT 'assigned'
    CHECK (status IN ('assigned','waiting_for_acceptance','accepted','declined','ready_to_start','in_service','delayed','cancelled')),
  assigned_technician_id UUID NOT NULL REFERENCES technicians(id),
  station TEXT,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  notes TEXT,
  delay_status TEXT NOT NULL DEFAULT 'none'
    CHECK (delay_status IN ('none','warning','late','critical')),
  delay_reason TEXT,
  technician_notified_at TIMESTAMPTZ,
  customer_notified_at TIMESTAMPTZ,
  serving_idempotency_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pos_tech_queue_tenant ON pos_tech_queue_tickets (tenant_id, branch_id, status, assigned_at);
CREATE INDEX IF NOT EXISTS idx_pos_tech_queue_tech ON pos_tech_queue_tickets (tenant_id, assigned_technician_id, status);
-- Idempotent transfer: one key per ticket so retries never duplicate a Serving ticket.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_tech_queue_serving_key ON pos_tech_queue_tickets (tenant_id, serving_idempotency_key) WHERE serving_idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS pos_tech_queue_audit (
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
CREATE INDEX IF NOT EXISTS idx_pos_tech_queue_audit_tenant ON pos_tech_queue_audit (tenant_id, created_at DESC);
