-- 488_appointment_arrived_status.sql — Functional Decision 38: ARRIVED is a real appointment status.
-- The front desk (or the kiosk) records that the customer is in the salon before they are checked in. Until now
-- 'arrived' existed only in TypeScript types; the table refused it. LATE is computed on read, never stored (see
-- packages/api-contracts/src/appointment-status.ts), so it is deliberately NOT added here.
-- 'arrived' holds the chair: the no-overlap exclusion constraints (426/482) list only the statuses that do NOT block
-- (cancelled, no_show, completed), so an arrived appointment already blocks a double booking with no change there.
ALTER TABLE pos_tech_appointments DROP CONSTRAINT IF EXISTS pos_tech_appointments_status_check;
ALTER TABLE pos_tech_appointments ADD CONSTRAINT pos_tech_appointments_status_check
  CHECK (status IN ('booked', 'confirmed', 'arrived', 'checked_in', 'waiting', 'in_service', 'completed', 'cancelled', 'no_show'));
ALTER TABLE pos_tech_appointments ADD COLUMN IF NOT EXISTS arrived_at TIMESTAMPTZ;
COMMENT ON COLUMN pos_tech_appointments.arrived_at IS 'When the customer was marked arrived (Decision 38); server time.';
