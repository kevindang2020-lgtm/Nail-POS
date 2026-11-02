-- 138_tech_queue_acceptance_deadline.sql — server-driven acceptance timeout (spec §12). Adds an acceptance_deadline
-- to each tech-queue offer (stamped at offer creation when the tenant requires acceptance) and an 'expired' status so a
-- past-deadline, still-unaccepted offer can be swept to a distinct, non-active state (the front desk / auto-balance then
-- re-assigns). assigned_at already exists (the offer start). Idempotent: ADD COLUMN IF NOT EXISTS + re-stated CHECK.
ALTER TABLE pos_tech_queue_tickets ADD COLUMN IF NOT EXISTS acceptance_deadline TIMESTAMPTZ;

ALTER TABLE pos_tech_queue_tickets DROP CONSTRAINT IF EXISTS pos_tech_queue_tickets_status_check;
ALTER TABLE pos_tech_queue_tickets DROP CONSTRAINT IF EXISTS pos_tech_queue_tickets_status_allowed;
ALTER TABLE pos_tech_queue_tickets ADD CONSTRAINT pos_tech_queue_tickets_status_allowed
  CHECK (status IN ('assigned','waiting_for_acceptance','accepted','declined','ready_to_start','in_service','paused','delayed','expired','cancelled'));

-- the sweep scans by (status, acceptance_deadline) for unaccepted, past-deadline offers
CREATE INDEX IF NOT EXISTS idx_pos_tech_queue_acceptance_deadline
  ON pos_tech_queue_tickets (status, acceptance_deadline)
  WHERE acceptance_deadline IS NOT NULL;
