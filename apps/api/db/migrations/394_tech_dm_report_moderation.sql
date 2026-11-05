-- 394_tech_dm_report_moderation.sql — Technician Social Profile, Phase 8: give DM reports a moderation lifecycle so a
-- Super Admin can work the queue. Additive: existing open reports simply default to 'open'.
ALTER TABLE tech_dm_reports ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'open';   -- open | resolved
ALTER TABLE tech_dm_reports ADD COLUMN IF NOT EXISTS resolution TEXT;                        -- dismiss | block_thread (moderator note)
ALTER TABLE tech_dm_reports ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
ALTER TABLE tech_dm_reports ADD COLUMN IF NOT EXISTS resolved_by_user_id UUID;
CREATE INDEX IF NOT EXISTS idx_tech_dm_reports_status ON tech_dm_reports (status, created_at DESC);
