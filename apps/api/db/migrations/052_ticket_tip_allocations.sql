-- 052_ticket_tip_allocations.sql — explicit per-technician tip splits for a ticket. When rows exist for a ticket they
-- govern that ticket's tip entirely (a technician's share is its row, or 0); when NO rows exist for a ticket, earnings
-- fall back to a proportional split of tickets.tip_cents by each technician's service-line revenue on that ticket.
CREATE TABLE IF NOT EXISTS ticket_tip_allocations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  branch_id     UUID,
  ticket_id     UUID NOT NULL,
  technician_id UUID NOT NULL,
  tip_cents     INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, ticket_id, technician_id)
);
CREATE INDEX IF NOT EXISTS idx_tip_alloc_ticket ON ticket_tip_allocations (tenant_id, ticket_id);
CREATE INDEX IF NOT EXISTS idx_tip_alloc_tech ON ticket_tip_allocations (tenant_id, technician_id);
