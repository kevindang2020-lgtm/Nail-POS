-- 743_booking_verification_center.sql — Booking Phone Verification Complete Build Guide (Oct 30 2026). ADDITIVE ONLY.
--
--   • booking_verification_settings.high_value_threshold_cents — the salon's own "high-value booking" line (guide §9:
--     "make the threshold admin-configurable and auditable"). NULL = not configured → the high-value rule never fires
--     (the screen says so instead of guessing a number).
--   • booking_verification_sessions.policy_reason — WHY this booking had to verify (the resolver's machine reason, e.g.
--     risk_deposit / reverify_window_elapsed / phone_changed). The details overlay explains the rule that forced it
--     (guide §13, §17.3) from the row, not from today's settings.
--   • history index: tenant + created_at DESC + id DESC (guide §12 newest-first paging).
--
-- Rollback: the two columns are nullable and unread by older code; DROP COLUMN / DROP INDEX is safe.

ALTER TABLE booking_verification_settings
  ADD COLUMN IF NOT EXISTS high_value_threshold_cents integer;
ALTER TABLE booking_verification_settings DROP CONSTRAINT IF EXISTS booking_verification_settings_high_value_chk;
ALTER TABLE booking_verification_settings ADD CONSTRAINT booking_verification_settings_high_value_chk
  CHECK (high_value_threshold_cents IS NULL OR (high_value_threshold_cents >= 100 AND high_value_threshold_cents <= 10000000));

ALTER TABLE booking_verification_sessions
  ADD COLUMN IF NOT EXISTS policy_reason text;

CREATE INDEX IF NOT EXISTS idx_bvs_tenant_created
  ON booking_verification_sessions (tenant_id, created_at DESC, id DESC);
