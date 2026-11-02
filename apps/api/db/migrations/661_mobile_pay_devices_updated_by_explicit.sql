-- 661 — mobile_pay_devices.updated_by, stated explicitly (Oct 13 2026).
-- The column already exists on every database migrated through 543 (the Phase 10 actor-stamp loop adds it dynamically), and
-- the Tap to Pay device rebind (modules/checkout/src/mobile-checkout/mobile-pay-device.kysely.ts) writes it. This no-op on an
-- up-to-date database states it in a static migration so the schema-consistency check (and a reader) can see it.
ALTER TABLE mobile_pay_devices ADD COLUMN IF NOT EXISTS updated_by UUID;
