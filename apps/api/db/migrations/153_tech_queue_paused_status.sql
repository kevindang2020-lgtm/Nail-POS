-- 137_tech_queue_paused_status.sql — add a 'paused' status to pos_tech_queue_tickets so a technician can pause an
-- in-service ticket and resume it later (spec §18/§34). The original inline CHECK (migration 027) did not allow
-- 'paused'; this re-states it with the value added. The Tech App view already maps 'paused' → paused (asTechTicketStatus),
-- and the existing start-service guard already permits resuming from a paused ticket. ticket_service_lines.status is
-- free-text (no CHECK), so the per-line pause marker needs no schema change. Idempotent re-statement of the CHECK.
ALTER TABLE pos_tech_queue_tickets DROP CONSTRAINT IF EXISTS pos_tech_queue_tickets_status_check;
ALTER TABLE pos_tech_queue_tickets DROP CONSTRAINT IF EXISTS pos_tech_queue_tickets_status_allowed;
ALTER TABLE pos_tech_queue_tickets ADD CONSTRAINT pos_tech_queue_tickets_status_allowed
  CHECK (status IN ('assigned','waiting_for_acceptance','accepted','declined','ready_to_start','in_service','paused','delayed','cancelled'));
