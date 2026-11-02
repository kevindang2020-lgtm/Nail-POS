-- 742_phone_management_center.sql — Phone Number Management Complete Build Guide (Oct 30 2026). ADDITIVE ONLY.
--
-- The change workflow already exists (373 customer_phones / customer_phone_update_sessions / tenant_customer_phone_settings, 520 lifecycle,
-- the booking-verification six-digit challenge, the 'customer.phone.sync' job). This migration only:
--   1. lets the security notice to the OLD number be recorded against its change request (notifications.source_type 'phone_change'),
--      so the overlay can show submitted vs delivered instead of assuming delivery;
--   2. indexes the history and recovery reads the new Phone Management center makes (tenant-first, newest-first, open-by-deadline).
-- Rollback: drop the two indexes; restore the previous ck_notifications_source_type list (no row uses 'phone_change' before this release).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_notifications_source_type') THEN
    ALTER TABLE notifications DROP CONSTRAINT ck_notifications_source_type;
  END IF;
  ALTER TABLE notifications ADD CONSTRAINT ck_notifications_source_type CHECK (source_type IS NULL OR source_type IN
    ('appointment', 'ticket', 'campaign', 'thread', 'follow_up', 'retry', 'template_test', 'manual', 'phone_change'));
END $$;

CREATE INDEX IF NOT EXISTS idx_cpus_tenant_created ON customer_phone_update_sessions (tenant_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_cpus_tenant_open_expiry ON customer_phone_update_sessions (tenant_id, expires_at) WHERE completed_at IS NULL;
