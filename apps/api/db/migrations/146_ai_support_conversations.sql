-- 134_ai_support_conversations.sql
-- Persist AI Support Assistant turns (spec §14) so support can see what was asked, what was answered, and which
-- approved sources were cited — and so a low-confidence turn can be escalated into a ticket. We store ONLY the
-- user's question, the assistant's answer text, the grounding outcome, and the cited source list. We never store
-- secrets (system prompts, API keys, provider internals). Tenant-scoped; no rows seeded.

CREATE TABLE IF NOT EXISTS ai_support_conversations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL,
  user_id             UUID,
  turn_count          INTEGER NOT NULL DEFAULT 0,
  last_grounded       BOOLEAN,
  escalated_ticket_id UUID REFERENCES support_tickets(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_support_conversations_tenant ON ai_support_conversations (tenant_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS ai_support_messages (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  UUID NOT NULL REFERENCES ai_support_conversations(id) ON DELETE CASCADE,
  tenant_id        UUID NOT NULL,
  user_id          UUID,
  question         TEXT NOT NULL,
  answer           TEXT NOT NULL,
  grounded         BOOLEAN NOT NULL DEFAULT false,
  confidence       TEXT,
  sources          JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_support_messages_conversation ON ai_support_messages (conversation_id, created_at);
