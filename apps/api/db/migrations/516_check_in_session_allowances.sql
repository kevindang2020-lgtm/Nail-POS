-- 516_check_in_session_allowances.sql — a check-in session's lookup / new-profile allowances are counted on the session
-- row (Oct 6 2026).
--
-- A guest's session may look up 8 phone numbers and create 3 profiles (MAX_LOOKUPS_PER_SESSION /
-- MAX_CREATES_PER_SESSION) — the brake on someone at a kiosk or display walking through phone numbers. Those counts lived
-- in each API instance's memory: with several instances (or after a restart) a session's requests landed on different
-- counters and the allowance multiplied. Now one atomic UPDATE … RETURNING on the session row counts every request,
-- whichever instance serves it.
ALTER TABLE go_checkin_sessions ADD COLUMN IF NOT EXISTS lookup_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE go_checkin_sessions ADD COLUMN IF NOT EXISTS create_count INTEGER NOT NULL DEFAULT 0;
