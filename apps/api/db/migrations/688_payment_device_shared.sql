-- 688_payment_device_shared.sql — Secure Tap to Pay mandate §14 / §77 (Oct 23 2026): a SHARED salon phone (the front-desk
-- iPhone) keeps ONE device identity while the signed-in employee changes; every payment stays attributed to whoever was
-- signed in (payments.created_by_user_id). A personal phone (the default) stays bound to the employee who registered it.
-- Shared is decided by the owner when creating the pairing code (POS, step-up) — never by the phone.
ALTER TABLE mobile_pay_devices ADD COLUMN IF NOT EXISTS shared BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE payment_device_pairings ADD COLUMN IF NOT EXISTS shared BOOLEAN NOT NULL DEFAULT false;
