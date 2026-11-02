-- 436_ai_prompt_versions.sql — Constitution 10 §21–§25: immutable prompt versions with rollout and rollback.
--
-- WHY A NEW TABLE and not ai_global_prompts (245): that table has UNIQUE (prompt_key) and an integer `version`
-- bumped in place. Every edit OVERWRITES the production prompt — the exact thing §22 forbids — and no
-- historical AI result can ever know which text produced it. ai_global_prompts stays for what it is (a head
-- pointer / display record); this table is the ledger of what was actually sent.
--
-- IMMUTABILITY (§22): the content columns of a version row can never change after insert. A trigger refuses
-- the UPDATE. Only the lifecycle columns (status, rollout, approved_by, approved_at) may move.

CREATE TABLE IF NOT EXISTS ai_prompt_versions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_key         TEXT NOT NULL,                          -- = task key, e.g. review.response_draft
  module             TEXT NOT NULL,
  task_key           TEXT NOT NULL,
  version            INTEGER NOT NULL CHECK (version >= 1),
  system_instructions TEXT NOT NULL,                         -- §27 SYSTEM POLICY + APPLICATION INSTRUCTIONS
  template           TEXT NOT NULL,                          -- §26 with {{typed_variables}}
  variables          JSONB NOT NULL DEFAULT '[]'::jsonb,     -- §26: [{name, type, untrusted}] — untrusted ones are delimited (§28)
  output_schema_key  TEXT NOT NULL,                          -- §73
  language_behavior  TEXT NOT NULL DEFAULT 'match_input',    -- §194/§196
  status             TEXT NOT NULL DEFAULT 'DRAFT'
                     CHECK (status IN ('DRAFT','TESTING','ACTIVE','DEPRECATED','ROLLED_BACK')),   -- §23
  -- §24 rollout: a version may be ACTIVE for selected tenants and/or a percentage before full production.
  rollout_tenant_ids UUID[] NOT NULL DEFAULT '{}',
  rollout_percent    SMALLINT NOT NULL DEFAULT 100 CHECK (rollout_percent BETWEEN 0 AND 100),
  content_sha256     TEXT NOT NULL,                          -- §242 reproducibility: hash of system+template
  created_by_user_id UUID,
  approved_by_user_id UUID,                                  -- §21 approved_by; §291 must differ from created_by for HIGH tasks
  approved_at        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (prompt_key, version)
);
CREATE INDEX IF NOT EXISTS ix_ai_prompt_versions_key_status ON ai_prompt_versions (prompt_key, status);

-- §22: content is immutable once written.
CREATE OR REPLACE FUNCTION ai_prompt_versions_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW.system_instructions IS DISTINCT FROM OLD.system_instructions
     OR NEW.template IS DISTINCT FROM OLD.template
     OR NEW.variables IS DISTINCT FROM OLD.variables
     OR NEW.output_schema_key IS DISTINCT FROM OLD.output_schema_key
     OR NEW.version IS DISTINCT FROM OLD.version
     OR NEW.prompt_key IS DISTINCT FROM OLD.prompt_key
     OR NEW.content_sha256 IS DISTINCT FROM OLD.content_sha256 THEN
    RAISE EXCEPTION 'ai_prompt_versions is immutable: create a new version instead of editing % v% (§22)', OLD.prompt_key, OLD.version;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_ai_prompt_versions_immutable ON ai_prompt_versions;
CREATE TRIGGER trg_ai_prompt_versions_immutable BEFORE UPDATE ON ai_prompt_versions
  FOR EACH ROW EXECUTE FUNCTION ai_prompt_versions_immutable();

-- §25 rollback audit: who, what, reason, when. Append-only.
CREATE TABLE IF NOT EXISTS ai_prompt_rollbacks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_key      TEXT NOT NULL,
  from_version    INTEGER NOT NULL,
  to_version      INTEGER NOT NULL,
  reason          TEXT NOT NULL CHECK (length(reason) >= 10),
  actor_user_id   UUID NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_ai_prompt_rollbacks_key ON ai_prompt_rollbacks (prompt_key, created_at DESC);
