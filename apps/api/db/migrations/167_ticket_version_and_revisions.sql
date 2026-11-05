-- 167_ticket_version_and_revisions.sql — optimistic-concurrency version + permanent in-service edit timeline (epic Req §5/§9).
-- `tickets.version` increments on every recorded content edit during service; clients may pass an expected version to
-- detect a lost update (409). `ticket_revisions` is an append-only history of what changed, by whom — never deleted.
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS ticket_revisions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id       UUID NOT NULL,
  tenant_id       UUID,
  branch_id       UUID,
  version         INTEGER NOT NULL,
  action          TEXT NOT NULL,                 -- service_added | service_updated | service_removed | technician_assigned | helper_assigned
  service_line_id UUID,
  actor_user_id   UUID,
  actor_role      TEXT,
  before          JSONB,
  after           JSONB,
  summary         TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ticket_revisions_ticket ON ticket_revisions (ticket_id, version);
