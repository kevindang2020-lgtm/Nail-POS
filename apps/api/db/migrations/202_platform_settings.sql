-- 173_platform_settings.sql
-- Platform-wide General Settings (Super Admin → System Settings → General Settings).
--
-- Model: the CODE holds the platform defaults (platform-settings-defaults.ts). This table stores only settings that
-- an administrator has EXPLICITLY set (overriding the code default). The effective platform value for a key is the
-- stored row if present, else the code default — so nothing is silently seeded and every explicit change is versioned.
-- `platform_setting_changes` is the immutable, append-only history (never overwritten).

CREATE TABLE IF NOT EXISTS platform_settings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_key     text NOT NULL UNIQUE,
  setting_group   text NOT NULL,
  value           jsonb NOT NULL,
  value_type      text NOT NULL DEFAULT 'string',      -- string|number|boolean|json|color|url|email|locale|currency|timezone
  version         integer NOT NULL DEFAULT 1,
  override_policy text NOT NULL DEFAULT 'overridable',  -- overridable|tenant_only|mandatory
  is_sensitive    boolean NOT NULL DEFAULT false,
  is_mandatory    boolean NOT NULL DEFAULT false,
  effective_from  timestamptz NOT NULL DEFAULT now(),
  changed_by      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_platform_settings_group ON platform_settings (setting_group);

-- Immutable change-set history. One row per changed setting; previous/new values preserved for audit + rollback.
CREATE TABLE IF NOT EXISTS platform_setting_changes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_key     text NOT NULL,
  setting_group   text NOT NULL,
  previous_value  jsonb,
  new_value       jsonb,
  version         integer NOT NULL,
  actor           text,
  actor_role      text,
  reason          text,
  source          text NOT NULL DEFAULT 'ui',           -- ui|import|reset|rollback|api
  correlation_id  text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_platform_setting_changes_key ON platform_setting_changes (setting_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_setting_changes_created ON platform_setting_changes (created_at DESC);
