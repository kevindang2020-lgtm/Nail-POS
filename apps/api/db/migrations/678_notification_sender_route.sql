-- 678_notification_sender_route.sql — deep-scan / pilot handoff mandate §65 (Oct 22 2026): an SMS in the ledger recorded the
-- provider's message id, but not WHICH sending path carried it, so support could not answer "did salon A's text go out on
-- salon A's own Twilio account / number?" without asking the provider. Two facts, written at send time:
--   sender_route  'tenant_account'       the salon's own Twilio account (tenant_messaging_credentials)
--                 'shared_salon_number'  the platform account, From = the salon's registered number / Messaging Service
--                 'shared_default'       the platform account and its default sender (no salon number)
--   sender_from   the From number or Messaging Service id (MG…) used, when known — an address, never a credential.
-- Older rows stay NULL (unknown — never back-filled with a guess). EXPAND-ONLY, idempotent, nullable columns (no rewrite);
-- the CHECK is validated at once (every existing row is NULL, which it accepts — migration 547: no NOT VALID left behind).
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS sender_route TEXT,
  ADD COLUMN IF NOT EXISTS sender_from  TEXT;
DO $$ BEGIN
  ALTER TABLE notifications ADD CONSTRAINT notifications_sender_route_chk
    CHECK (sender_route IS NULL OR sender_route IN ('tenant_account', 'shared_salon_number', 'shared_default'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
