-- 185_ai_providers.sql
-- AI provider credentials + global prompt configuration for AI Usage & Configuration.
-- CRITICAL: an API key is stored ONLY as AES-256-GCM ciphertext (api_key_ciphertext). A masked form (api_key_masked)
-- and a short fingerprint (api_key_fingerprint) are stored for display/confirmation. The plaintext key is NEVER
-- persisted in the clear and NEVER returned to a client after saving.
CREATE TABLE IF NOT EXISTS ai_providers (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_key        TEXT NOT NULL,                 -- openai | anthropic | google | retell | ...
  display_name        TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'inactive' CHECK (status IN ('active','inactive','error','disabled')),
  default_model       TEXT,
  api_key_ciphertext  TEXT,                          -- AES-256-GCM only; never plaintext
  api_key_masked      TEXT,                          -- e.g. sk_live_••••••••9X4K
  api_key_fingerprint TEXT,
  last_sync_at        TIMESTAMPTZ,
  created_by_user_id  UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ai_provider_key ON ai_providers (provider_key);

CREATE TABLE IF NOT EXISTS ai_global_prompts (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_key         TEXT NOT NULL,                  -- e.g. reminders | smart_reminders | reporting_assistant
  name               TEXT NOT NULL,
  body               TEXT,
  version            INTEGER NOT NULL DEFAULT 1,
  status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','draft','archived')),
  updated_by_user_id UUID,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (version >= 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ai_global_prompt_key ON ai_global_prompts (prompt_key);
