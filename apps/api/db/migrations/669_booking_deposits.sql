-- 669_booking_deposits.sql — Decision D11 (Oct 14 2026 build plan), rebuilt Oct 21 2026: BOOKING DEPOSITS through the one
-- payment domain. A salon that requires a deposit takes it card-on-file at booking time (CardPointe, the customer's token
-- from the hosted tokenizer; the gateway keeps a stored profile so the same card can be charged a no-show fee later),
-- applies it to the visit's ticket at checkout, refunds it on a cancellation inside the salon's window, and keeps it
-- (forfeits) on a late cancellation or a no-show — each as the salon's policy says. One deposit per appointment.
--
-- pos_tech_appointments.deposit_status (migration 028: not_required / required / paid / failed) stays the appointment's
-- summary; this table carries the money and its life: pending → captured | failed; captured → applied | refunded | forfeited.
CREATE TABLE IF NOT EXISTS booking_deposits (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 UUID NOT NULL REFERENCES tenants(id),
  branch_id                 UUID NOT NULL REFERENCES branches(id),
  appointment_id            UUID NOT NULL REFERENCES pos_tech_appointments(id),
  customer_id               UUID REFERENCES customers(id),
  amount_cents              INTEGER NOT NULL CHECK (amount_cents > 0),
  status                    TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'captured', 'failed', 'applied', 'refunded', 'forfeited')),
  -- the charge (the ONE provider router chose the merchant; its reference settles disputes)
  processor_type            TEXT,
  processor_transaction_id  TEXT,
  card_profile_id           TEXT,            -- the gateway's stored profile (card-on-file), never a card number
  card_last4                TEXT,
  captured_at               TIMESTAMPTZ,
  -- the salon's policy, snapshotted at booking time (a later settings change does not move this guest's deadline)
  refundable_until          TIMESTAMPTZ,     -- NULL = never refundable once captured
  forfeit_on_no_show        BOOLEAN NOT NULL DEFAULT TRUE,
  -- how it ended
  applied_ticket_id         UUID REFERENCES tickets(id),
  applied_payment_id        UUID REFERENCES payments(id),
  applied_cents             INTEGER,         -- what the ticket took (the rest, if any, went back to the card)
  refund_transaction_id     TEXT,
  refunded_cents            INTEGER,
  ended_reason              TEXT,            -- 'customer_cancelled' | 'salon_cancelled' | 'no_show' | 'checkout' | 'late_cancellation'
  failure_reason            TEXT,            -- the processor's answer on a decline, or the lost-answer note
  idempotency_key           TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by                UUID,
  CONSTRAINT booking_deposits_one_per_appointment UNIQUE (tenant_id, appointment_id)
);
CREATE INDEX IF NOT EXISTS booking_deposits_tenant_status_idx ON booking_deposits (tenant_id, status);
CREATE INDEX IF NOT EXISTS booking_deposits_customer_idx ON booking_deposits (tenant_id, customer_id);
CREATE UNIQUE INDEX IF NOT EXISTS booking_deposits_tenant_idem_uq ON booking_deposits (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- B-12: every tenant → tenant foreign key carries the same-salon guard (apps/api/src/common/tenant-consistency.pgtest
-- asserts no uncovered pair).
CREATE TRIGGER trg_tc_booking_deposits__appointment_id BEFORE INSERT OR UPDATE OF tenant_id, appointment_id ON booking_deposits FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('pos_tech_appointments', 'appointment_id');
CREATE TRIGGER trg_tc_booking_deposits__customer_id BEFORE INSERT OR UPDATE OF tenant_id, customer_id ON booking_deposits FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('customers', 'customer_id');
CREATE TRIGGER trg_tc_booking_deposits__applied_ticket_id BEFORE INSERT OR UPDATE OF tenant_id, applied_ticket_id ON booking_deposits FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('tickets', 'applied_ticket_id');
CREATE TRIGGER trg_tc_booking_deposits__applied_payment_id BEFORE INSERT OR UPDATE OF tenant_id, applied_payment_id ON booking_deposits FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('payments', 'applied_payment_id');
CREATE TRIGGER trg_tc_booking_deposits__branch_id BEFORE INSERT OR UPDATE OF tenant_id, branch_id ON booking_deposits FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('branches', 'branch_id');
