-- 295_support_ticket_attachments.sql — Support Center ticket attachments (metadata; §18 storage substrate).
-- File bytes live in the private attachment storage root behind the established MediaStorage port (S3-shaped
-- interface, local-disk driver in dev) — NOT in this table, and NOT under the publicly served /media root.
-- storage_key is a private object reference and is never exposed by any read shape or API response.
-- Append/soft-delete only: rows are marked deleted (deleted_at) so the ticket's audit story stays intact.

CREATE TABLE IF NOT EXISTS support_ticket_attachments (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL,
  ticket_id          UUID NOT NULL REFERENCES support_tickets (id) ON DELETE CASCADE,
  uploader_user_id   UUID,
  storage_key        TEXT NOT NULL,
  file_name          TEXT NOT NULL,
  content_type       TEXT NOT NULL,
  size_bytes         BIGINT NOT NULL,
  deleted_at         TIMESTAMPTZ,
  deleted_by_user_id UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_support_ticket_attachments_ticket ON support_ticket_attachments (ticket_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_support_ticket_attachments_tenant ON support_ticket_attachments (tenant_id, created_at DESC);
