-- 461_session_step_up.sql — Constitution 7 §8: critical platform actions require RECENT strong authentication.
-- A successful step-up (password + TOTP re-proven for the SAME session) stamps the session row; a critical route
-- accepts the session only while the stamp is younger than its window. No new session is minted.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_step_up_at TIMESTAMPTZ NULL;
