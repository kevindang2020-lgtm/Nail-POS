-- 087_overview_monthly_snapshots.sql
-- Monthly KPI snapshots powering accurate month-over-month trends on the Super-Admin Overview for state-based metrics
-- (active salons, pending applications, payment-setup-needed, open support) that cannot be reconstructed from history.
-- POST /super-admin/overview/snapshot captures the current month (idempotent per month).

CREATE TABLE IF NOT EXISTS overview_monthly_snapshots (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  month                       TEXT NOT NULL UNIQUE,              -- 'YYYY-MM'
  total_tenants               INTEGER NOT NULL DEFAULT 0,
  active_salons               INTEGER NOT NULL DEFAULT 0,
  pending_applications        INTEGER NOT NULL DEFAULT 0,
  payment_setup_needed        INTEGER NOT NULL DEFAULT 0,
  monthly_card_volume_cents   BIGINT  NOT NULL DEFAULT 0,
  open_support_tickets        INTEGER NOT NULL DEFAULT 0,
  system_health_percent       NUMERIC(5,2) NOT NULL DEFAULT 100,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_overview_snapshots_month ON overview_monthly_snapshots (month DESC);
