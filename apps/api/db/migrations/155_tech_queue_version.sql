-- 139_tech_queue_version.sql — optimistic-concurrency record version on the assignment lane (spec §13/§20). Every
-- mutation bumps version (version = version + 1); a client that holds a stale version can pass expectedVersion so the
-- guarded UPDATE matches 0 rows and the server rejects the write as a conflict. This is defense-in-depth on top of the
-- existing status guards + idempotency keys (which already prevent the headline double-accept race). Idempotent.
ALTER TABLE pos_tech_queue_tickets ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 0;
