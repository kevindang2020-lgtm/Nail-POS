-- 162_tech_social_link_visibility.sql — per-link visibility for technician Professional Links (epic Req §3).
-- Parallel to the existing global_tech_profiles.profile_links URL map; holds { instagram:'public'|'booked_only'|'hidden', ... }.
-- A missing key defaults to 'public' so existing rows keep today's all-public behavior. Nullable; no rows seeded.
ALTER TABLE global_tech_profiles ADD COLUMN IF NOT EXISTS profile_link_visibility JSONB;
