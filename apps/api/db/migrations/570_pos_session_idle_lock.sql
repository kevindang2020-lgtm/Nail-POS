-- 570_pos_session_idle_lock.sql — Kevin, Oct 12 2026: "POS auto-lock is on by default at 60 minutes, also locked on the server,
-- with a full sign-in after 8 hours locked." (Functional Decision 35, server side.)
--
-- Migration 491 let the POS lock its session (POST /auth/lock → 423 SESSION_LOCKED until the PIN; locked > 8 h → revoked). But
-- the lock still STARTED in the browser: a cleared tab, a second tab or a direct API call was never idle-locked. Now the server
-- derives the lock itself from the session's last activity:
--   client_app        'pos' when the POS web app signed in (X-Client-Type: pos); NULL for every other client. Only 'pos'
--                     sessions of a salon are idle-locked (the mobile apps, owner / admin / tech web, scripts are not; the kiosk
--                     and the customer display use device tokens, not sessions).
--   last_activity_at  a person's last activity on that POS session: sign-in, a correct PIN, POST /auth/session-activity (sent by
--                     the POS at most once a minute while someone touches the screen). Reads, polling and realtime streams never
--                     move it (last_seen_at, 2026 §146, does — it is not an activity clock).
--   pin_failures      wrong PINs on this session since its last correct one. The per-user PIN limiter (Redis) is a no-op where
--                     Redis is not configured, so a locked POS could be PIN-guessed without limit: now the 5th wrong PIN on a
--                     session ends it (full sign-in), on every deployment, across API servers.
-- Idle for the salon's minutes (tenant_settings security.autoLockMinutes, default 60) → locked_at = last_activity_at + minutes.
-- Columns on the existing sessions row: no new table, retention unchanged (sessions: security, 90 days after expires_at).
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS client_app TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS pin_failures INTEGER NOT NULL DEFAULT 0;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sessions_client_app_check') THEN
    ALTER TABLE sessions ADD CONSTRAINT sessions_client_app_check CHECK (client_app IS NULL OR client_app IN ('pos'));
  END IF;
END $$;
COMMENT ON COLUMN sessions.client_app IS 'pos = signed in by the POS web app (X-Client-Type: pos): idle-locked by the server (Oct 12 2026). NULL = any other client.';
COMMENT ON COLUMN sessions.last_activity_at IS 'POS sessions: a person''s last activity (sign-in, PIN unlock, POST /auth/session-activity) — the server idle-lock clock. Never moved by reads / polling / streams.';
COMMENT ON COLUMN sessions.pin_failures IS 'Wrong PINs since the last correct one (Oct 12 2026); the 5th ends the session.';
