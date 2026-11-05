-- 089_overview_snapshot_paused_trial.sql
-- Extend monthly KPI snapshots with paused (suspended) and trial tenant counts so the Tenants/Salons "Paused Tenants"
-- and "Trial Tenants" KPI cards get accurate month-over-month trends (previously they had no snapshot baseline and
-- always rendered "vs last month"). Backfilled to 0; real values land from the next POST /super-admin/overview/snapshot.

ALTER TABLE overview_monthly_snapshots
  ADD COLUMN IF NOT EXISTS paused_tenants INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS trial_tenants  INTEGER NOT NULL DEFAULT 0;
