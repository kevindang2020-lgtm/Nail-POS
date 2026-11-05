-- 302_ai_receptionist_agents.sql — tenant-facing AI Front Desk agents (draft/config lifecycle) + immutable versions.
-- These store the salon's CONFIGURATION for a receptionist agent (name, call type, language, greeting, behavior,
-- use case). They are NOT the provider (Retell) agent — provider provisioning is a later step; provider_agent_id
-- stays NULL until an account is connected, and status stays 'draft' until then. Every row is tenant-owned and
-- branch-scoped. Reuses the platform's existing services for all booking data; nothing here duplicates appointments,
-- customers, services, technicians, hours, or settings.

CREATE TABLE IF NOT EXISTS ai_receptionist_agents (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL,
  branch_id          UUID,                               -- NULL = tenant-wide default agent
  name               TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'draft',      -- draft | ready | live | paused | error | archived
  call_type          TEXT NOT NULL DEFAULT 'inbound',    -- inbound | outbound | both (outbound gated by feature flag)
  language           TEXT NOT NULL DEFAULT 'en',
  use_case           TEXT,                               -- salon's own label; configuration only, never the system prompt
  greeting           TEXT,                               -- editable greeting template (with {{business_name}}/{{agent_name}})
  behavior           TEXT,                               -- editable behavior notes; protected safety rules are enforced server-side
  provider           TEXT,                               -- 'retell' once connected; NULL while unprovisioned
  provider_agent_id  TEXT,                               -- NULL until a provider account is connected
  knowledge_version  INTEGER NOT NULL DEFAULT 0,
  created_by_user_id UUID,
  updated_by_user_id UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_air_agents_tenant_status ON ai_receptionist_agents (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_air_agents_tenant_branch ON ai_receptionist_agents (tenant_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_air_agents_tenant_created ON ai_receptionist_agents (tenant_id, created_at);

-- Immutable config snapshots: one row per published/saved version of an agent (for history + rollback).
CREATE TABLE IF NOT EXISTS ai_receptionist_agent_versions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL,
  agent_id           UUID NOT NULL,
  version            INTEGER NOT NULL,
  configuration      JSONB NOT NULL,                     -- the agent's config at this version
  created_by_user_id UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_air_agent_version ON ai_receptionist_agent_versions (tenant_id, agent_id, version);
CREATE INDEX IF NOT EXISTS idx_air_agent_versions_agent ON ai_receptionist_agent_versions (tenant_id, agent_id);
