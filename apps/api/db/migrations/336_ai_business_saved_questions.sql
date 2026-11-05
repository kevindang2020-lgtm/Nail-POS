-- 320_ai_business_saved_questions.sql — saved questions for the AI Business Assistant (spec §35).
-- Each row belongs to one tenant AND one creating user. sharing_scope 'private' = only the creator sees it;
-- 'tenant' = any user in the same tenant may see/run it. A saved question stores a BOUNDED intent + optional
-- default period; it never stores cross-tenant context and never stores raw model prompts.
CREATE TABLE IF NOT EXISTS ai_business_saved_questions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL,
  user_id        UUID NOT NULL,                      -- creator/owner of the saved question
  title          TEXT NOT NULL,
  intent         TEXT NOT NULL,                      -- one of the bounded assistant intents (validated app-side)
  preset         TEXT,                               -- optional default reporting period
  compare_preset TEXT,                               -- optional comparison period (explain-change)
  question       TEXT,                               -- optional original free-text question
  sharing_scope  TEXT NOT NULL DEFAULT 'private'
    CHECK (sharing_scope IN ('private','tenant')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at   TIMESTAMPTZ
);

-- Primary access path: a tenant's questions, filtered to the current user's private ones plus tenant-shared ones.
CREATE INDEX IF NOT EXISTS ai_business_saved_questions_tenant_user_idx
  ON ai_business_saved_questions (tenant_id, user_id);
CREATE INDEX IF NOT EXISTS ai_business_saved_questions_tenant_scope_idx
  ON ai_business_saved_questions (tenant_id, sharing_scope);
