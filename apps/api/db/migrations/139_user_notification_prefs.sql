-- 134_user_notification_prefs.sql — the signed-in user's PERSONAL notification preferences
-- (Account → Notifications, §20). Tenant-scoped per (tenant_id, user_id), like user_avatars /
-- user_login_alert_prefs. These are the user's own alert channels/categories — distinct from the
-- salon's customer-facing comms config (§21), which lives in the settings module and is NOT touched here.
-- Defaults: every preference on (matches the panel's "all on" baseline).
CREATE TABLE IF NOT EXISTS user_notification_prefs (
  tenant_id               TEXT NOT NULL,
  user_id                 TEXT NOT NULL,
  sms_notifications       BOOLEAN NOT NULL DEFAULT true,
  email_notifications     BOOLEAN NOT NULL DEFAULT true,
  push_notifications      BOOLEAN NOT NULL DEFAULT true,
  missed_call_alerts      BOOLEAN NOT NULL DEFAULT true,
  booking_alerts          BOOLEAN NOT NULL DEFAULT true,
  low_stock_alerts        BOOLEAN NOT NULL DEFAULT true,
  payroll_approvals       BOOLEAN NOT NULL DEFAULT true,
  weekly_report_summaries BOOLEAN NOT NULL DEFAULT true,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);
