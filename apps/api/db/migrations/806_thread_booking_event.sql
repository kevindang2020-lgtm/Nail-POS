-- 806_thread_booking_event.sql — C2 audit (Nov 4 2026), Communications guide §9.3: a booking made from a conversation is linked
-- back to it — the conversation's event log records 'booking_created' with the appointment id (once per appointment).
ALTER TABLE communication_thread_events DROP CONSTRAINT IF EXISTS communication_thread_events_event_type_check;
ALTER TABLE communication_thread_events ADD CONSTRAINT communication_thread_events_event_type_check
  CHECK (event_type IN ('read', 'unread', 'assigned', 'status_changed', 'snoozed', 'customer_linked', 'booking_created'));
CREATE UNIQUE INDEX IF NOT EXISTS uq_comm_thread_events_booking ON communication_thread_events (tenant_id, thread_id, new_value) WHERE event_type = 'booking_created';
