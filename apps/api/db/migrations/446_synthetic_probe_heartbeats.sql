-- 446_synthetic_probe_heartbeats.sql — Constitution 11 §92: the synthetic database write-path probe's own table.
--
-- One row per API instance, upserted by that instance's probe and read straight back. It proves the WRITE path
-- (connection, transaction, commit, read-your-write) without touching any tenant's data or any business table.
-- Bounded by construction: rows = instances.
CREATE TABLE IF NOT EXISTS synthetic_probe_heartbeats (
  instance_id  TEXT PRIMARY KEY,
  token        TEXT NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
