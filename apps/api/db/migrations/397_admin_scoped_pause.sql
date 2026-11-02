-- 397_admin_scoped_pause.sql — Super Admin Technician Account Management, Phase 3: scoped pauses.
-- These are Super-Admin overrides, kept SEPARATE from the technician's own is_public / accepts_messages toggles. That
-- separation matters: an admin pause overrides the technician's choice while it is on, and lifting it restores the
-- technician's own setting rather than clobbering it. The public-facing result is "technician wants it on AND admin
-- hasn't suppressed it."
ALTER TABLE global_tech_profiles ADD COLUMN IF NOT EXISTS admin_profile_hidden   BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE global_tech_profiles ADD COLUMN IF NOT EXISTS admin_messaging_paused BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE global_tech_profiles ADD COLUMN IF NOT EXISTS admin_deals_frozen     BOOLEAN NOT NULL DEFAULT false;
