-- 677_export_bytes_to_object_storage.sql — B-18 (Oct 22 2026): report / export FILES leave the database rows.
-- Three tables kept whole files as base64 in a column (super_admin_scheduled_report_runs.artifact_base64,
-- billing_export_jobs.content_b64, revenue_export_jobs.content). New runs / jobs write the bytes to the PRIVATE object
-- store (packages/media private-store: never a public URL, streamed by the API after authorization) and keep only the
-- KEY here; the old columns stay and are still read for rows written before this (nothing is removed or moved).
ALTER TABLE super_admin_scheduled_report_runs ADD COLUMN IF NOT EXISTS artifact_key TEXT;
ALTER TABLE billing_export_jobs ADD COLUMN IF NOT EXISTS content_key TEXT;
ALTER TABLE revenue_export_jobs ADD COLUMN IF NOT EXISTS content_key TEXT;
