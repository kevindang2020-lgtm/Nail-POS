-- 393_tech_profile_events.sql — Technician Social Profile, Phase 6: real profile analytics.
-- Every row is an actual event: a profile load, a tapped link, an opened post, a started conversation. Nothing here is
-- estimated or synthesized — the technician's analytics are a straight aggregation of these rows. Authoritative events
-- (profile_view, message_open) are written server-side and can't be spoofed by a client; low-stakes taps (link_click,
-- post_tap) are reported by the app against a fixed whitelist.
CREATE TABLE IF NOT EXISTS tech_profile_events (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  global_tech_profile_id UUID NOT NULL,
  event_type            TEXT NOT NULL,          -- profile_view | link_click | post_tap | message_open
  viewer_user_id         UUID,                  -- nullable: a public profile view may be anonymous
  ref                    TEXT,                  -- optional target (e.g. the link key, or the post id)
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tech_profile_events_profile ON tech_profile_events (global_tech_profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tech_profile_events_type ON tech_profile_events (global_tech_profile_id, event_type, created_at DESC);
