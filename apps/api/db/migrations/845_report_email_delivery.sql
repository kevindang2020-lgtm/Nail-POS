-- 845_report_email_delivery.sql — Daily Summary "Email Report" / "Schedule Report" (batch 9 decision 1, Nov 10 2026:
-- Kevin — "pick and continue fix all it").
--
-- CONSENT MODEL: a report is only ever e-mailed to the signed-in staff member's OWN account address, and only a staff
-- member can put themselves on a schedule (owner_user_id = the person who asked; consented_at = when they did). Nobody can
-- subscribe someone else, and no free-typed address exists — so salon figures never leave to an address nobody vouched for.
-- Turning a schedule off is one click for the person; a deactivated / removed staff account is skipped (and logged).
--
-- report_email_subscriptions: one row per (salon, person, report). frequency daily = yesterday's salon day; weekly = the
-- last Monday–Sunday. send_at is the salon-local hour the scheduler sends after.
-- report_email_deliveries: every attempt (one-off or scheduled), with its honest outcome. occurrence_key makes a scheduled
-- send idempotent: a restart or a second replica records (and sends) the same occurrence once.
CREATE TABLE IF NOT EXISTS report_email_subscriptions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id),
  branch_id      UUID,
  owner_user_id  UUID NOT NULL,
  report_key     TEXT NOT NULL DEFAULT 'daily_summary' CHECK (report_key IN ('daily_summary')),
  frequency      TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly')),
  send_at        TEXT NOT NULL DEFAULT '07:00' CHECK (send_at ~ '^([01][0-9]|2[0-3]):00$'),
  active         BOOLEAN NOT NULL DEFAULT true,
  consented_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by     UUID
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_report_email_subscriptions_owner ON report_email_subscriptions (tenant_id, owner_user_id, report_key);
CREATE INDEX IF NOT EXISTS ix_report_email_subscriptions_due ON report_email_subscriptions (active, tenant_id);

CREATE TABLE IF NOT EXISTS report_email_deliveries (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id),
  branch_id        UUID,
  subscription_id  UUID REFERENCES report_email_subscriptions(id) ON DELETE SET NULL,
  owner_user_id    UUID NOT NULL,
  report_key       TEXT NOT NULL DEFAULT 'daily_summary',
  kind             TEXT NOT NULL CHECK (kind IN ('now', 'scheduled')),
  period_from      DATE NOT NULL,
  period_to        DATE NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'simulated', 'failed', 'not_configured', 'skipped')),
  detail           TEXT,
  provider_id      TEXT,
  occurrence_key   TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by       UUID   -- the person (send-now) or NULL for the scheduler
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_report_email_deliveries_occurrence ON report_email_deliveries (tenant_id, occurrence_key) WHERE occurrence_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_report_email_deliveries_tenant ON report_email_deliveries (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_report_email_deliveries_owner ON report_email_deliveries (tenant_id, owner_user_id, created_at DESC);
