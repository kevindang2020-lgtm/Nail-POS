-- 300_voice_learning.sql — the human-approved, versioned improvement loop for the AI receptionist (Phase 25).
-- Core safety property encoded here: the AI never auto-changes production prompts. Suggestions are captured from calls
-- but sit in 'open' until a human reviews them; approving a suggestion only creates a DRAFT prompt version; a prompt
-- version becomes live ONLY via an explicit human activation. Prices/hours/policies/permissions/booking-validation are
-- never touched by this pipeline at all (enforced in code).

CREATE TABLE IF NOT EXISTS voice_prompt_versions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  scope             TEXT NOT NULL DEFAULT 'default',       -- e.g. per-agent/per-branch scope key
  version_label     TEXT NOT NULL,                         -- human label, e.g. 'v3'
  body              TEXT NOT NULL,                          -- the prompt text
  status            TEXT NOT NULL DEFAULT 'draft',          -- draft | pending_review | active | archived
  parent_version_id UUID,                                   -- the version this was derived from (for rollback lineage)
  created_by        UUID,
  approved_by       UUID,
  activated_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- At most ONE active prompt version per (tenant, scope). This DB-level guarantee backs the code's single-active rule.
CREATE UNIQUE INDEX IF NOT EXISTS uq_voice_prompt_active ON voice_prompt_versions (tenant_id, scope) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_voice_prompt_tenant ON voice_prompt_versions (tenant_id, scope, created_at DESC);

CREATE TABLE IF NOT EXISTS voice_improvement_suggestions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  source_call_id    TEXT,                                   -- the call that prompted this (provider_call_id)
  category          TEXT NOT NULL,                          -- e.g. 'repeated_questions' | 'tool_failure' | 'bad_wording'
  target_type       TEXT NOT NULL,                          -- prompt | faq | knowledge | pronunciation | tool_description
  detail            TEXT NOT NULL,                          -- the human-readable suggestion
  status            TEXT NOT NULL DEFAULT 'open',           -- open | approved | rejected | applied
  reviewed_by       UUID,
  resulting_version_id UUID,                                -- the draft prompt version an approval produced (if any)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_voice_suggestions_tenant ON voice_improvement_suggestions (tenant_id, status, created_at DESC);
