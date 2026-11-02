-- 028_tech_appointments.sql — POS Tech Appointments (technician scheduling board) tenant-scoped appointments.
CREATE TABLE IF NOT EXISTS pos_tech_appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  branch_id UUID,
  technician_id UUID NOT NULL REFERENCES technicians(id),
  customer_id UUID,
  customer_name TEXT NOT NULL,
  customer_phone TEXT,
  is_vip BOOLEAN NOT NULL DEFAULT false,
  source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('walk_in','phone','online','google','ai','customer_app','manual')),
  services JSONB NOT NULL DEFAULT '[]'::jsonb,
  appt_date DATE NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  duration_minutes INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'booked'
    CHECK (status IN ('booked','confirmed','checked_in','waiting','in_service','completed','cancelled','no_show')),
  deposit_status TEXT NOT NULL DEFAULT 'not_required'
    CHECK (deposit_status IN ('not_required','required','paid','failed')),
  notes TEXT,
  queue_idempotency_key TEXT,
  tech_queue_idempotency_key TEXT,
  serving_idempotency_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pos_tech_appts_tenant_date ON pos_tech_appointments (tenant_id, branch_id, appt_date, technician_id);
CREATE INDEX IF NOT EXISTS idx_pos_tech_appts_status ON pos_tech_appointments (tenant_id, appt_date, status);
-- Idempotent transfers: one key per appointment per destination so retries never duplicate a downstream ticket.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_tech_appts_queue_key ON pos_tech_appointments (tenant_id, queue_idempotency_key) WHERE queue_idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_tech_appts_techqueue_key ON pos_tech_appointments (tenant_id, tech_queue_idempotency_key) WHERE tech_queue_idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_tech_appts_serving_key ON pos_tech_appointments (tenant_id, serving_idempotency_key) WHERE serving_idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS pos_tech_appointments_audit (
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
CREATE INDEX IF NOT EXISTS idx_pos_tech_appts_audit_tenant ON pos_tech_appointments_audit (tenant_id, created_at DESC);
