-- 558_mobile_app_versions.sql — BUILD_PLAN Phase 13 B (Constitution 6 §55–57 app version enforcement, §150 app version
-- dashboard). Platform-global (no tenant): the store apps are the same binaries for every salon.
--
-- mobile_app_versions: one row per (store app, native platform) Super Admin has configured. NO ROW = NOTHING IS REFUSED.
--   min_supported  a native build below it gets 426 UPDATE_REQUIRED (API gate) and the app's hard update screen.
--                  Set only for a security issue, a breaking API change or a critical defect (§56) — never every release.
--   recommended    below it the app shows a dismissible "update available" banner (UPDATE_RECOMMENDED).
--   latest         informational (what the store has now).
--   store_url      where the update screen sends people; required when min_supported is set (checked in the API too).
-- Web builds are never version-gated (platform is ios | android only). Changes: Super Admin API only (step-up + reason +
-- audit); `version` is an optimistic lock.
CREATE TABLE IF NOT EXISTS mobile_app_versions (
  app            text NOT NULL CHECK (app IN ('customer', 'tech', 'owner', 'manager-pay')),
  platform       text NOT NULL CHECK (platform IN ('ios', 'android')),
  min_supported  text CHECK (min_supported IS NULL OR min_supported ~ '^\d{1,5}(\.\d{1,5}){0,2}$'),
  recommended    text CHECK (recommended IS NULL OR recommended ~ '^\d{1,5}(\.\d{1,5}){0,2}$'),
  latest         text CHECK (latest IS NULL OR latest ~ '^\d{1,5}(\.\d{1,5}){0,2}$'),
  store_url      text CHECK (store_url IS NULL OR (store_url LIKE 'https://%' AND length(store_url) <= 500)),
  message        text CHECK (message IS NULL OR length(message) <= 300),
  reason         text CHECK (reason IS NULL OR length(reason) <= 500),
  version        integer NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid,
  PRIMARY KEY (app, platform),
  CONSTRAINT mobile_app_versions_min_needs_store CHECK (min_supported IS NULL OR store_url IS NOT NULL)
);

-- mobile_app_installs_seen: the §150 version distribution. One row per install (a SHA-256 of the app's X-Device-ID —
-- the raw device id is never stored), refreshed at most once an hour per install by the API from the client headers
-- the mobile transport sends. "Active installs" = rows seen in the last 7 days. No tenant, no user: an install count is
-- not personal data. Rows older than 90 days are pruned by the same writer.
CREATE TABLE IF NOT EXISTS mobile_app_installs_seen (
  app            text NOT NULL CHECK (app IN ('customer', 'tech', 'owner', 'manager-pay')),
  platform       text NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  device_hash    text NOT NULL CHECK (device_hash ~ '^[0-9a-f]{64}$'),
  app_version    text NOT NULL CHECK (length(app_version) <= 40),
  first_seen_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (app, platform, device_hash)
);
CREATE INDEX IF NOT EXISTS mobile_app_installs_seen_recent_idx ON mobile_app_installs_seen (last_seen_at);
