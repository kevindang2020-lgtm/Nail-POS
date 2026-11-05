-- 569_queue_multitech_routing.sql — serving-time multi-technician routing (split visits + parties).
-- EXPAND-ONLY: new nullable / defaulted columns and one partial unique index; no table, no rewrite of existing rows.
--   • queue_service_assignments: the per-line plan becomes the canonical record of WHO serves WHICH service — versioned
--     (CAS per line), with its timing (side by side / after another line), the engine's planned start offset (display
--     only), how it was chosen, the technician-queue part it is served on, and when it started / finished.
--   • pos_tech_queue_tickets.visit_part: a split visit is projected as one tech-queue ticket per line technician
--     (1..n); NULL = the whole visit (every legacy row) — the unique index makes the per-part projection idempotent.
--   • queue_assignment_decisions.plan: the lines a plan decision applied (accepted / adjusted / auto).
ALTER TABLE queue_service_assignments ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE queue_service_assignments ADD COLUMN IF NOT EXISTS timing TEXT NOT NULL DEFAULT 'parallel' CHECK (timing IN ('parallel','after'));
ALTER TABLE queue_service_assignments ADD COLUMN IF NOT EXISTS after_service_id UUID;          -- timing='after': starts when this line ends
ALTER TABLE queue_service_assignments ADD COLUMN IF NOT EXISTS planned_start_offset_min INTEGER; -- engine ETA at assign time (display only)
ALTER TABLE queue_service_assignments ADD COLUMN IF NOT EXISTS source TEXT;                       -- staff / ai_suggestion / auto_assign
ALTER TABLE queue_service_assignments ADD COLUMN IF NOT EXISTS tech_queue_ticket_id UUID;         -- the part this line is served on
ALTER TABLE queue_service_assignments ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE queue_service_assignments ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE pos_tech_queue_tickets ADD COLUMN IF NOT EXISTS visit_part SMALLINT;                  -- null = whole visit (legacy)
CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_tech_queue_visit_part ON pos_tech_queue_tickets (tenant_id, queue_item_id, visit_part)
  WHERE visit_part IS NOT NULL AND queue_item_id IS NOT NULL;
ALTER TABLE queue_assignment_decisions ADD COLUMN IF NOT EXISTS plan JSONB;                       -- the lines a plan decision applied
