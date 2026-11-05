-- 573_technician_clock_pin_disable.sql — merge of the Oct 2026 Technician Profile package (their 453).
-- Termination / suspension must DISABLE the technician's kiosk Clock PIN, not just rely on technicians.is_active.
-- The shared revocation chain (modules/workforce/src/technicians/revoke-technician-access.ts) stamps disabled_at; the
-- identify/verify paths exclude any disabled row, and a manager reset (upsertPin) clears it. Additive + idempotent.
ALTER TABLE technician_clock_pins ADD COLUMN IF NOT EXISTS disabled_at     TIMESTAMPTZ;
ALTER TABLE technician_clock_pins ADD COLUMN IF NOT EXISTS disabled_reason TEXT;
