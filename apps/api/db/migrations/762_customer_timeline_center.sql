-- 762_customer_timeline_center.sql — Customer Timeline guide (Nov 1 2026).
-- Additive only. Rollback: DROP TABLE customer_timeline_health_runs; DROP INDEX ix_pos_queue_items_tenant_customer,
-- ix_membership_activity_tenant_customer, ix_gift_cards_tenant_customer, ix_payments_tenant_ticket, ix_receipts_tenant_ticket,
-- ix_customer_merge_logs_tenant_source, ix_customer_merge_logs_tenant_target.
--
-- The timeline keeps NO copy of history (guide §03: "not a second operational database"). Every event is read from the
-- system that owns it — Booking (pos_tech_appointments), Check-In / queues (pos_queue_items + pos_queue_status_history),
-- Serving / Service Done / Checkout (tickets + ticket_service_lines), Payments (payments, payment_refunds, receipts), the
-- Loyalty ledger, Memberships (membership_activity), Gift Cards (gift_card_transactions), Communications
-- (customer_notifications, appointment_reminders_sent) and Customer Management (customers, customer_merge_logs) — so an
-- event id is the source record's own id and a replayed delivery can never appear twice.
--
-- 1. Check Customer Timeline System runs are recorded (evidence + a 30-second rate limit per salon); a run only reads.
-- 2. Per-customer read indexes on the source tables that did not have one (each lookup is tenant + customer / ticket).

CREATE TABLE IF NOT EXISTS customer_timeline_health_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  branch_id     UUID,
  actor_user_id UUID,
  overall       TEXT NOT NULL CHECK (overall IN ('PASSED', 'WARNING', 'FAILED', 'INSUFFICIENT_DATA')),
  checks        JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_customer_timeline_health_recent ON customer_timeline_health_runs (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_pos_queue_items_tenant_customer ON pos_queue_items (tenant_id, customer_id, created_at DESC) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_membership_activity_tenant_customer ON membership_activity (tenant_id, customer_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS ix_gift_cards_tenant_customer ON gift_cards (tenant_id, customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_payments_tenant_ticket ON payments (tenant_id, ticket_id);
CREATE INDEX IF NOT EXISTS ix_receipts_tenant_ticket ON receipts (tenant_id, ticket_id);
CREATE INDEX IF NOT EXISTS ix_customer_merge_logs_tenant_source ON customer_merge_logs (tenant_id, source_customer_id);
CREATE INDEX IF NOT EXISTS ix_customer_merge_logs_tenant_target ON customer_merge_logs (tenant_id, target_customer_id);
