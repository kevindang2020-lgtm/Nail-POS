-- 299_voice_call_outcomes.sql — structured outcome record for each AI receptionist call (Phase 25/14 foundation).
-- This is metadata + a short summary, NOT raw transcripts or recordings (those are consent/retention-gated and stored
-- separately, not here). One row per call, upserted by (tenant_id, provider_call_id) so a retried outcome POST never
-- duplicates. tenant/branch come from the integration key server-side. Feeds call history, analytics, and the
-- human-reviewed learning loop — none of which may auto-change prompts/policies.

CREATE TABLE IF NOT EXISTS voice_call_outcomes (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL,
  branch_id              UUID NOT NULL,
  provider               TEXT NOT NULL DEFAULT 'retell',
  provider_call_id       TEXT NOT NULL,                         -- the voice provider's call id (dedup key)
  prompt_version         TEXT,                                  -- which prompt version served the call
  started_at             TIMESTAMPTZ,
  ended_at               TIMESTAMPTZ,
  duration_seconds       INTEGER,
  language               TEXT,                                  -- detected language, when provided
  intents                JSONB NOT NULL DEFAULT '[]'::jsonb,    -- detected intents (array of strings)
  tool_calls             JSONB NOT NULL DEFAULT '[]'::jsonb,    -- [{name, ok}] tool outcomes
  booking_outcome        TEXT,                                  -- e.g. 'booked' | 'none' | 'failed'
  handoff_outcome        TEXT,                                  -- e.g. 'transferred' | 'callback' | 'none'
  sentiment              TEXT,                                  -- coarse category, e.g. 'positive'|'neutral'|'negative'
  error_category         TEXT,
  interruption_count     INTEGER NOT NULL DEFAULT 0,
  repeated_question_count INTEGER NOT NULL DEFAULT 0,
  abandoned              BOOLEAN NOT NULL DEFAULT false,
  follow_up_required     BOOLEAN NOT NULL DEFAULT false,
  summary                TEXT,                                  -- short call summary (treat per retention policy)
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One outcome per provider call per tenant (idempotent upsert target).
CREATE UNIQUE INDEX IF NOT EXISTS uq_voice_call_outcomes_call ON voice_call_outcomes (tenant_id, provider_call_id);
-- Call-history + analytics reads: newest first per tenant/branch.
CREATE INDEX IF NOT EXISTS idx_voice_call_outcomes_tenant_time ON voice_call_outcomes (tenant_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_voice_call_outcomes_branch ON voice_call_outcomes (tenant_id, branch_id, started_at DESC);
