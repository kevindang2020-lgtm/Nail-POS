-- 392_tech_dm.sql — Technician Social Profile, Phase 5: customer ↔ technician direct messaging.
-- This is a NEW, focused in-app DM system, deliberately NOT built on communication_threads: that table is the salon's
-- SMS/email inbox (tenant-scoped, channel + inbound/outbound + staff-assignment semantics). A global peer-to-peer DM
-- between a customer and a technician's global profile doesn't belong in the salon inbox and must not appear there.
-- Safety model: only a customer who has BOOKED with the technician may open a thread, and a technician can switch DMs
-- off entirely; either party can block or report a thread.

ALTER TABLE global_tech_profiles ADD COLUMN IF NOT EXISTS accepts_messages BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS tech_dm_threads (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  global_tech_profile_id UUID NOT NULL,
  customer_user_id       UUID NOT NULL,                 -- the customer (users.id)
  status                 TEXT NOT NULL DEFAULT 'active', -- active | blocked_by_customer | blocked_by_technician
  last_message_at        TIMESTAMPTZ,
  last_message_preview   TEXT,
  customer_unread        INTEGER NOT NULL DEFAULT 0,
  technician_unread      INTEGER NOT NULL DEFAULT 0,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- one thread per (technician profile, customer) pair
CREATE UNIQUE INDEX IF NOT EXISTS uq_tech_dm_thread ON tech_dm_threads (global_tech_profile_id, customer_user_id);
CREATE INDEX IF NOT EXISTS idx_tech_dm_threads_customer ON tech_dm_threads (customer_user_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_tech_dm_threads_tech ON tech_dm_threads (global_tech_profile_id, last_message_at DESC);

CREATE TABLE IF NOT EXISTS tech_dm_messages (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id  UUID NOT NULL REFERENCES tech_dm_threads(id) ON DELETE CASCADE,
  sender     TEXT NOT NULL,                             -- customer | technician
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tech_dm_messages_thread ON tech_dm_messages (thread_id, created_at);

CREATE TABLE IF NOT EXISTS tech_dm_reports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id       UUID NOT NULL,
  reported_by     TEXT NOT NULL,                        -- customer | technician
  reporter_user_id UUID,
  reason          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
