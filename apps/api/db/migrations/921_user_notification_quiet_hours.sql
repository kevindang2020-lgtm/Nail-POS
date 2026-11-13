-- 921_user_notification_quiet_hours.sql — Customer Notifications 08 (extras round 10): personal quiet hours per user
-- (Account → Notifications). Salon local time 'HH:MM'; both set or both NULL (= off). The push dispatcher holds a
-- non-required push to this person while inside the window (required notices — security — always go). Expand-only.
ALTER TABLE user_notification_prefs ADD COLUMN IF NOT EXISTS quiet_start TEXT;
ALTER TABLE user_notification_prefs ADD COLUMN IF NOT EXISTS quiet_end TEXT;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_notification_prefs_quiet_chk') THEN
    ALTER TABLE user_notification_prefs ADD CONSTRAINT user_notification_prefs_quiet_chk CHECK (
      (quiet_start IS NULL AND quiet_end IS NULL)
      OR (quiet_start IS NOT NULL AND quiet_end IS NOT NULL
        AND quiet_start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND quiet_end ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'));
  END IF;
END $$;
