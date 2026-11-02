-- 194_membership_kpi_snapshots.sql — daily KPI snapshots so the Membership Programs KPIs can show real period-over-period
-- trends (same pattern as queue_metrics_snapshots). A production job writes one row per KPI per day; the overview compares
-- today's live value to the latest prior snapshot. Seeds one "yesterday" snapshot as a dev fixture so trends render.
CREATE TABLE IF NOT EXISTS membership_kpi_snapshots (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date DATE NOT NULL,
  kpi_key       TEXT NOT NULL,
  value_num     BIGINT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_membership_kpi_snapshots ON membership_kpi_snapshots (snapshot_date, kpi_key);

-- Seed a "yesterday" baseline (dev fixture) so deltas are demonstrable. Values chosen near the seeded live counts so
-- deltas are modest and mixed (some favorable, some not). Production replaces this with a real daily job.
INSERT INTO membership_kpi_snapshots (snapshot_date, kpi_key, value_num)
SELECT (now() - interval '1 day')::date, k.key, k.val
FROM (VALUES
  ('totalPrograms', 5), ('activeMembers', 18), ('pausedMembers', 4), ('cancelledMembers', 4), ('pastDueMembers', 6),
  ('trialMembers', 4), ('mrrCents', 205000), ('failedPayments', 6), ('benefitsIssued', 28), ('benefitsRedeemed', 8),
  ('unusedCredits', 20), ('expiringCredits', 27), ('tenantParticipation', 2), ('branchParticipation', 2), ('suspiciousCount', 7)
) AS k(key, val)
WHERE NOT EXISTS (SELECT 1 FROM membership_kpi_snapshots WHERE snapshot_date = (now() - interval '1 day')::date);
