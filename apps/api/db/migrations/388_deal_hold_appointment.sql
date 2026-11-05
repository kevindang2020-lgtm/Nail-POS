-- 388_deal_hold_appointment.sql — link a redemption hold to the appointment it reserves (additive). On a successful
-- book-a-deal, the hold is marked 'consumed' and stamped with the appointment id so checkout (Phase 7) can find the
-- deal terms locked in at booking time. Oversell safety comes from the existing unique (deal_id, idempotency_key) index
-- plus a per-deal advisory lock in the service; this only records the appointment link.
ALTER TABLE deal_redemption_holds ADD COLUMN IF NOT EXISTS appointment_id UUID;
ALTER TABLE deal_redemption_holds ADD COLUMN IF NOT EXISTS deal_version INTEGER;
CREATE INDEX IF NOT EXISTS idx_deal_holds_appointment ON deal_redemption_holds (appointment_id);
