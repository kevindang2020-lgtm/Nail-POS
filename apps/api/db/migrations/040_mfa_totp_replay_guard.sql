-- 040_mfa_totp_replay_guard.sql
-- TOTP replay prevention (RFC 6238 §5.2): record the last time-step a confirmed TOTP factor successfully verified at,
-- so the same 6-digit code cannot be reused within its ±window validity. The login flow advances this value atomically
-- (UPDATE ... WHERE last_used_step IS NULL OR last_used_step < :step) and treats a no-op update as a replay.
ALTER TABLE mfa_factors
  ADD COLUMN IF NOT EXISTS last_used_step BIGINT;
