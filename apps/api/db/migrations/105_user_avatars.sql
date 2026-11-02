-- 105_user_avatars.sql — per-user profile avatar, tenant-scoped. Stores a small, client-resized
-- image as a data URL (the client downscales to 256px before upload, so rows stay small).
-- A user can only read/write their OWN avatar (enforced by session userId in the service).
CREATE TABLE IF NOT EXISTS user_avatars (
  tenant_id   TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  data_url    TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);
