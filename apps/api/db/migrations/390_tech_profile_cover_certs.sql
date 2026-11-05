-- 390_tech_profile_cover_certs.sql — Technician Social Profile, Phase 1 core gaps (additive). The global profile already
-- carries avatar/bio/specialties/languages/profile_links; this adds the cover image, certifications, style tags, and a
-- verification-status field. These are technician-owned GLOBAL columns on global_tech_profiles — they follow the
-- technician across salons and are never tenant-scoped.
ALTER TABLE global_tech_profiles ADD COLUMN IF NOT EXISTS cover_url TEXT;
ALTER TABLE global_tech_profiles ADD COLUMN IF NOT EXISTS certifications JSONB NOT NULL DEFAULT '[]';
ALTER TABLE global_tech_profiles ADD COLUMN IF NOT EXISTS style_tags JSONB NOT NULL DEFAULT '[]';
-- 'unverified' | 'pending' | 'verified' — scaffolding for the verification badge (section 19); the review workflow
-- itself is a later phase and only Super Admin may set 'verified'.
ALTER TABLE global_tech_profiles ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'unverified';
