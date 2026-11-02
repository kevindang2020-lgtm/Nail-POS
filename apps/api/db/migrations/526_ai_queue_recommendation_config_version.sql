-- 526_ai_queue_recommendation_config_version.sql — BUILD_PLAN Phase 6 (ai_queue_assignment → complete), Agent B.
--
-- A recommendation records the settings version it was made under. That version is the pair "<salon>.<branch>"
-- (queue_assignment_tenant_settings.version . queue_assignment_settings.version — see resolveEffective in
-- modules/ai/src/ai-queue-assignment/ai-queue-assignment-settings.ts), which an INTEGER column (added in 524) cannot
-- hold. Nothing has written the column yet (it arrived in 524 in this same phase), so the type change loses nothing.
ALTER TABLE queue_assignment_recommendations ALTER COLUMN config_version TYPE TEXT USING config_version::text;

-- The per-customer panel and the auto-run read "the latest suggestion for this guest" and "the decision with this
-- key"; both are tenant-scoped point reads.
CREATE INDEX IF NOT EXISTS idx_qad_tenant_recommendation ON queue_assignment_decisions (tenant_id, recommendation_id);
