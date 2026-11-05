-- 114_communications.sql — unified two-way customer messaging inbox (Communications, T14 / S12). A thread groups a
-- conversation with one customer on one channel; messages are the inbound/outbound turns. This is the two-way guest
-- inbox, distinct from the outbound notifications/reminders log (system sends, opt-outs). Tenant/branch scoped; messages
-- are appended (never edited). Additive + idempotent.
CREATE TABLE IF NOT EXISTS communication_threads (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL,
  branch_id            UUID,
  customer_id          UUID,
  customer_name        TEXT,
  customer_contact     TEXT,
  channel              TEXT NOT NULL DEFAULT 'sms',    -- sms | email | call
  subject              TEXT,
  status               TEXT NOT NULL DEFAULT 'open',   -- open | pending | replied | closed | missed
  assigned_to          UUID,
  assigned_to_name     TEXT,
  unread_count         INTEGER NOT NULL DEFAULT 0,
  last_message_at      TIMESTAMPTZ,
  last_message_preview TEXT,
  last_direction       TEXT,                           -- inbound | outbound
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_comm_threads_tenant_status   ON communication_threads (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_comm_threads_tenant_last     ON communication_threads (tenant_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_comm_threads_tenant_assigned ON communication_threads (tenant_id, assigned_to);

CREATE TABLE IF NOT EXISTS communication_messages (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL,
  thread_id      UUID NOT NULL,
  direction      TEXT NOT NULL,                  -- inbound | outbound
  channel        TEXT NOT NULL DEFAULT 'sms',
  body           TEXT NOT NULL,
  author_user_id UUID,
  author_name    TEXT,
  status         TEXT NOT NULL DEFAULT 'sent',   -- sent | delivered | read | failed
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_comm_messages_thread ON communication_messages (thread_id, created_at);
CREATE INDEX IF NOT EXISTS idx_comm_messages_tenant ON communication_messages (tenant_id, created_at DESC);
