-- 454_session_devices.sql — Constitution 12 §144–146: a session names the device it belongs to, and when it was last used.
--
-- "Sign out other devices" existed, but every session row was blank: login wrote no device id and no user agent,
-- so a user (or a Super Admin) could not tell a lost phone from a desktop in the list. Now a session carries a
-- device LABEL the app supplies (a display name — never a security decision), the platform, a per-install id, and
-- last_seen_at, touched at most once per minute so revocation stays a read per request.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS device_name  TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS platform     TEXT;      -- ios / android / web
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
