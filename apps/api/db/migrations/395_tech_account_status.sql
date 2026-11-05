-- 395_tech_account_status.sql — Super Admin Technician Account Management, Phase 1: the pause-vs-suspend status model.
-- A pause is a temporary, reversible platform restriction (technician-requested, or a review). It is deliberately a
-- DIFFERENT status from a suspension (a security/compliance action). We also allow 'locked' (a security lock) so the
-- enum is ready for it, and we keep an append-only history of every account-status change.

-- Extend the account-status enum. Keep the existing values; add 'paused' and 'locked'.
ALTER TABLE global_tech_profiles DROP CONSTRAINT IF EXISTS global_tech_profiles_status_check;
ALTER TABLE global_tech_profiles ADD  CONSTRAINT global_tech_profiles_status_check
  CHECK (status IN ('active', 'paused', 'locked', 'suspended', 'anonymized', 'merged'));

-- Pause bookkeeping (parallel to the existing suspended_at / suspend_reason, so pause and suspend never share a field).
ALTER TABLE global_tech_profiles ADD COLUMN IF NOT EXISTS paused_at        TIMESTAMPTZ;
ALTER TABLE global_tech_profiles ADD COLUMN IF NOT EXISTS pause_reason     TEXT;
ALTER TABLE global_tech_profiles ADD COLUMN IF NOT EXISTS pause_expires_at TIMESTAMPTZ;

-- Append-only account-status history (distinct from technician_status_events, which is on-shift/off-shift progress).
CREATE TABLE IF NOT EXISTS tech_account_status_events (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  global_tech_profile_id UUID NOT NULL,
  from_status            TEXT,
  to_status              TEXT NOT NULL,
  action                 TEXT NOT NULL,          -- paused | reactivated | suspended | restored | locked | unlocked | ...
  scope                  TEXT NOT NULL DEFAULT 'global_account',
  reason                 TEXT,
  actor_user_id          UUID,
  expires_at             TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tech_acct_status_events ON tech_account_status_events (global_tech_profile_id, created_at DESC);
