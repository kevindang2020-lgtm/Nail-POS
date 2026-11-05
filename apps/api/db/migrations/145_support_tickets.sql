-- 133_support_tickets.sql
-- Support ticket system (spec §20–21, §38, §41). Tickets, their conversation, and an audit event log — all
-- tenant scoped and never cross-tenant. A client idempotency_key dedupes double-submits (§41). Priority is
-- constrained; "critical" classification by ordinary users is downgraded + flagged for review in the service
-- (§20). No rows seeded — "My Tickets" shows an honest empty state until a tenant opens its first ticket.

CREATE TABLE IF NOT EXISTS support_tickets (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_number            TEXT NOT NULL UNIQUE,
  tenant_id                UUID NOT NULL,
  branch_id                UUID,
  created_by_user_id       UUID NOT NULL,
  subject                  TEXT NOT NULL,
  description              TEXT,
  category                 TEXT NOT NULL DEFAULT 'general',
  subcategory              TEXT,
  priority                 TEXT NOT NULL DEFAULT 'normal'
                           CHECK (priority IN ('low','normal','high','urgent','critical')),
  status                   TEXT NOT NULL DEFAULT 'submitted'
                           CHECK (status IN ('draft','submitted','open','assigned','waiting_support','waiting_customer',
                                             'in_progress','escalated','resolved','closed','reopened','canceled')),
  affected_module          TEXT,
  affected_branch_id       UUID,
  app_version              TEXT,
  assigned_agent           TEXT,
  response_target_minutes  INTEGER,
  needs_review             BOOLEAN NOT NULL DEFAULT false,
  idempotency_key          TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_support_tickets_tenant  ON support_tickets (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_tickets_creator ON support_tickets (tenant_id, created_by_user_id, created_at DESC);
-- dedupe double-submit: at most one ticket per (tenant, idempotency_key)
CREATE UNIQUE INDEX IF NOT EXISTS uq_support_tickets_idem ON support_tickets (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS support_ticket_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id       UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  tenant_id       UUID NOT NULL,
  author_user_id  UUID,
  author_kind     TEXT NOT NULL DEFAULT 'customer' CHECK (author_kind IN ('customer','agent','system')),
  body            TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_support_ticket_messages_ticket ON support_ticket_messages (ticket_id, created_at);

CREATE TABLE IF NOT EXISTS support_ticket_events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id      UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  tenant_id      UUID NOT NULL,
  kind           TEXT NOT NULL,
  detail         TEXT,
  actor_user_id  UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_support_ticket_events_ticket ON support_ticket_events (ticket_id, created_at);
