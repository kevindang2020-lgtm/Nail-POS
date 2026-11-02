-- 440_ai_price_versions.sql — Constitution 10 §96 / §218: versioned provider pricing.
--
-- THE BUG THIS FIXES: prices lived in a flat code table with no effective date. When a provider changed its
-- rates, every historical ai_usage_logs row silently re-valued, because cost was recomputed from whatever the
-- table said today. A month-over-month cost comparison spanning a price change was simply wrong, and nothing
-- said so. §218: "Version pricing. Never overwrite old cost metadata."
--
-- Two independent fixes, because they solve different halves:
--   1. This table, so a rate has an effective_from date and a historical rate is still readable.
--   2. ai_usage_logs.price_version_id, so a row records WHICH rate priced it. Even if this table were edited
--      badly, a stored row still knows what it was charged under.

CREATE TABLE IF NOT EXISTS ai_price_versions (
  -- A readable slug, not a UUID: a price version id appears in usage rows and invoices, and
  -- 'pv-openai-gpt4omini-2024-07' tells an operator what they are looking at where a UUID tells them nothing.
  -- It is also stable across environments, so the in-code seed and the table agree without a sync step.
  id               TEXT PRIMARY KEY,
  provider         TEXT NOT NULL,
  model            TEXT NOT NULL,
  -- §96 "other unit rates": tokens for text, audio-seconds for transcription. The unit is explicit so Whisper
  -- stops being priced through a token-shaped column with a fudge factor.
  unit             TEXT NOT NULL DEFAULT 'tokens' CHECK (unit IN ('tokens','audio_seconds','images','characters')),
  in_per_m         NUMERIC(14,6) NOT NULL CHECK (in_per_m >= 0),
  out_per_m        NUMERIC(14,6) NOT NULL DEFAULT 0 CHECK (out_per_m >= 0),
  effective_from   DATE NOT NULL,
  -- NULL = still current. Set when a newer version supersedes it; the old row is never deleted or edited.
  effective_to     DATE,
  source_note      TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, model, effective_from),
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);
CREATE INDEX IF NOT EXISTS ix_ai_price_versions_lookup ON ai_price_versions (model, effective_from DESC);

-- Exactly one open-ended (current) row per model. A second would make "today's price" ambiguous.
CREATE UNIQUE INDEX IF NOT EXISTS ux_ai_price_current ON ai_price_versions (provider, model) WHERE effective_to IS NULL;

-- §218: a usage row records which price version valued it, so history survives a rate change regardless of
-- what the price table later says. Nullable because rows written before this migration have no version.
-- TEXT, matching ai_price_versions.id. A first draft typed this UUID; the seed ids are slugs, so every insert
-- failed — and the usage logger's best-effort `.catch()` swallowed it silently. Caught only by a PGlite
-- round-trip test that asserted the row comes BACK, which is the sort of failure a unit test cannot see.
ALTER TABLE ai_usage_logs ADD COLUMN IF NOT EXISTS price_version_id TEXT;
CREATE INDEX IF NOT EXISTS ix_ai_usage_logs_price_version ON ai_usage_logs (price_version_id);
