-- 556_tech_queue_done_states.sql — BUILD_PLAN Phase 12 (Constitution 5 §74–§78, API_DEFINITION_OF_DONE #27): the technician
-- queue ticket's END states.
--
-- Found by check:state-transitions (rule V1, a literal written to a vocabulary column outside its CHECK): the tech app's
-- "Service done" (TechKyselyRepository.complete) writes pos_tech_queue_tickets.status = 'service_done', and the POS
-- appointment status change writes 'service_done' / 'no_show' when an appointment is completed or marked no-show — but the
-- CHECK (migration 154) never listed either, so complete() failed on its LAST statement (after the ticket and its service
-- lines were already marked done — no transaction), and the POS path's write was swallowed, leaving the offer 'in_service'
-- or 'assigned' on the technician's board. The readers already treat them as done (tech.kysely.repository.ts counts
-- 'service_done' as completed). The vocabulary gains the two end states; nothing else changes.
--
-- Large-table safe: the Phase 10 helper adds the widened CHECK NOT VALID, counts violators (none — it only widens) and
-- validates, so no deploy can fail on existing data.
ALTER TABLE pos_tech_queue_tickets DROP CONSTRAINT IF EXISTS pos_tech_queue_tickets_status_allowed;
DO $$
BEGIN
  PERFORM schema_apply_check('pos_tech_queue_tickets', 'pos_tech_queue_tickets_status_allowed',
    'status IN (''assigned'', ''waiting_for_acceptance'', ''accepted'', ''declined'', ''ready_to_start'', ''in_service'', ''paused'', ''delayed'', ''expired'', ''cancelled'', ''service_done'', ''no_show'')',
    '556_tech_queue_done_states.sql');
END $$;
