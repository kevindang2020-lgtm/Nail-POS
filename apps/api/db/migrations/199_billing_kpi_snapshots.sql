-- 199_billing_kpi_snapshots.sql — daily KPI snapshots so Billing KPIs show real period-over-period trends (same pattern
-- as membership_kpi_snapshots). A production job writes one row per KPI per day; the overview compares today's live value
-- to the latest prior snapshot. Seeds one "yesterday" snapshot as a dev fixture so deltas render.
CREATE TABLE IF NOT EXISTS billing_kpi_snapshots (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date DATE NOT NULL,
  kpi_key       TEXT NOT NULL,
  value_num     BIGINT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_billing_kpi_snapshots ON billing_kpi_snapshots (snapshot_date, kpi_key);

INSERT INTO billing_kpi_snapshots (snapshot_date, kpi_key, value_num)
SELECT (now() - interval '1 day')::date, k.key, k.val
FROM (VALUES
  ('activeSubscriptions', 1), ('trialAccounts', 1), ('pastDueAccounts', 3), ('failedPayments', 2),
  ('invoices', 4), ('creditsIssuedCents', 6000), ('discountsAppliedCents', 4500), ('addOnsActive', 2),
  ('subscriptionChanges', 1), ('cancellationRequests', 0), ('upcomingRenewals', 0), ('mrrCents', 18000)
) AS k(key, val)
WHERE NOT EXISTS (SELECT 1 FROM billing_kpi_snapshots WHERE snapshot_date = (now() - interval '1 day')::date);
