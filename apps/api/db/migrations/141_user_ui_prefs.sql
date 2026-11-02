-- 136_user_ui_prefs.sql — the signed-in user's PERSONAL UI preferences (Account → Preferences, §33).
-- Tenant-scoped per (tenant_id, user_id), exactly like user_notification_prefs / user_login_alert_prefs.
-- Scope is deliberately honest: the only genuinely-effective preference today is default_landing — the
-- screen the user lands on when they open the app (honored by the root redirect in pos-web). Hollow
-- preferences (theme/language/density) are intentionally NOT added until those systems exist, so we never
-- persist a toggle that does nothing. Default landing: 'overview'.
CREATE TABLE IF NOT EXISTS user_ui_prefs (
  tenant_id       TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  default_landing TEXT NOT NULL DEFAULT 'overview',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);
