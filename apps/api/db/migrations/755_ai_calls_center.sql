-- 755_ai_calls_center.sql — AI Calls & Voice Intelligence guide (Oct 31 2026). Additive only.
--
-- P0 (guide §05): the AI Calls page was empty because NOTHING received Retell's call lifecycle webhooks. A call row
-- (voice_call_outcomes) was only ever written when the agent itself POSTed /voice/calls/:id/outcome — a custom function
-- the agent has to be configured to call. Retell's own call_started / call_ended / call_analyzed events had no receiver.
-- This migration adds the durable, de-duplicated event store those events (and the outcome post) now land in, the
-- per-invocation tool ledger (request → result, never inferred from what the AI said), sync facts on the call record,
-- and the recorded runs of "Check AI Calls System".
--
-- Rollback (no data loss for existing features):
--   DROP TABLE IF EXISTS ai_calls_health_runs; DROP TABLE IF EXISTS voice_tool_executions; DROP TABLE IF EXISTS voice_call_events;
--   ALTER TABLE voice_call_outcomes DROP COLUMN IF EXISTS last_event_at, DROP COLUMN IF EXISTS last_synced_at,
--     DROP COLUMN IF EXISTS agent_ref, DROP COLUMN IF EXISTS disconnection_reason, DROP COLUMN IF EXISTS direction;

-- 1 · provider events — one row per provider event (dedupe key), never the raw payload (only its SHA-256)
CREATE TABLE IF NOT EXISTS voice_call_events (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL,
  branch_id          UUID,
  provider           TEXT NOT NULL DEFAULT 'retell',
  provider_event_key TEXT NOT NULL,                 -- the provider's event id, or sha256(type|call|payload) when it sends none
  event_type         TEXT NOT NULL CHECK (event_type IN ('call_started', 'call_ended', 'call_analyzed', 'outcome_posted')),
  provider_call_id   TEXT NOT NULL,
  occurred_at        TIMESTAMPTZ,                   -- provider time of the fact (out-of-order safe merge uses it)
  received_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_received_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  deliveries         INTEGER NOT NULL DEFAULT 1 CHECK (deliveries >= 1),
  payload_sha256     TEXT NOT NULL,
  auth               TEXT NOT NULL CHECK (auth IN ('provider_signature', 'integration_key')),
  disposition        TEXT NOT NULL CHECK (disposition IN ('applied', 'stale_kept_newer', 'failed')),
  failure_reason     TEXT,                          -- sanitized category, never a payload or secret
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_voice_call_events_key ON voice_call_events (tenant_id, provider, provider_event_key);
CREATE INDEX IF NOT EXISTS idx_voice_call_events_call ON voice_call_events (tenant_id, provider_call_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_voice_call_events_recent ON voice_call_events (tenant_id, received_at DESC);

-- 2 · tool ledger — every tool request the agent made, its result and the verified business result
CREATE TABLE IF NOT EXISTS voice_tool_executions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL,
  branch_id          UUID NOT NULL,
  provider_call_id   TEXT NOT NULL,
  invocation_key     TEXT NOT NULL,                 -- sha256 of the signed request body: a retried request is the same row
  tool_name          TEXT NOT NULL,
  tool_kind          TEXT NOT NULL CHECK (tool_kind IN ('read', 'write', 'unknown')),
  status             TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'refused', 'succeeded', 'failed')),
  business_result    TEXT,                          -- e.g. slot_held / slot_taken / no_availability / info_returned
  related_type       TEXT,
  related_id         TEXT,
  error_category     TEXT,                          -- sanitized, never the provider message or customer text
  requests           INTEGER NOT NULL DEFAULT 1 CHECK (requests >= 1),
  requested_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_voice_tool_exec_invocation ON voice_tool_executions (tenant_id, provider_call_id, invocation_key);
CREATE INDEX IF NOT EXISTS idx_voice_tool_exec_recent ON voice_tool_executions (tenant_id, requested_at DESC);

-- 3 · sync facts on the canonical call record
ALTER TABLE voice_call_outcomes ADD COLUMN IF NOT EXISTS last_event_at TIMESTAMPTZ;
ALTER TABLE voice_call_outcomes ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ;
ALTER TABLE voice_call_outcomes ADD COLUMN IF NOT EXISTS agent_ref TEXT;
ALTER TABLE voice_call_outcomes ADD COLUMN IF NOT EXISTS disconnection_reason TEXT;
ALTER TABLE voice_call_outcomes ADD COLUMN IF NOT EXISTS direction TEXT;
CREATE INDEX IF NOT EXISTS idx_voice_call_outcomes_history ON voice_call_outcomes (tenant_id, (coalesce(started_at, created_at)) DESC, id DESC);

-- 4 · recorded runs of the read-only "Check AI Calls System"
CREATE TABLE IF NOT EXISTS ai_calls_health_runs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL,
  branch_id   UUID,
  overall     TEXT NOT NULL,
  checks      JSONB NOT NULL DEFAULT '[]'::jsonb,
  run_by      UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_calls_health_runs_tenant ON ai_calls_health_runs (tenant_id, created_at DESC);
