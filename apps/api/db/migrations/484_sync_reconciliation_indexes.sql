-- 484_sync_reconciliation_indexes.sql — Smooth Refresh spec §34/§35/§57 (Sep 30 2026).
--
-- EXPLAIN (ANALYZE) on 576k seeded appointments showed the 20 s reconciliation's "active scopes" query —
-- `WHERE updated_at > now() - interval '10 minutes'` — running as a PARALLEL SEQ SCAN of pos_tech_appointments
-- (108 ms, linear in table size, every 20 s): exactly the "scan every appointment every 20 seconds" §34 forbids.
-- The existing (tenant_id, branch_id, updated_at, id) index serves the per-branch change feed, but cannot serve a
-- cross-tenant "what changed recently" range. A plain updated_at index can.
--
-- PRODUCTION (same convention as 297): the runner applies each file in a transaction, so these are written plainly — and
-- a plain CREATE INDEX on a large pos_tech_appointments BLOCKS WRITES (new bookings) until it finishes. On a large
-- database, build them first, outside a transaction, then deploy; IF NOT EXISTS makes this file a no-op:
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pos_tech_appointments_updated_at ON pos_tech_appointments (updated_at);
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pos_queue_items_updated_at ON pos_queue_items (updated_at);
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_booking_holds_live_expires ON booking_holds (expires_at)
--     WHERE released_at IS NULL AND converted_appointment_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_pos_tech_appointments_updated_at ON pos_tech_appointments (updated_at);
CREATE INDEX IF NOT EXISTS idx_pos_queue_items_updated_at       ON pos_queue_items (updated_at);

-- Expired-hold sweep: released / converted holds stay in the table forever, so "live AND expired" becomes a scan of
-- history. A partial index over only the LIVE holds keeps the sweep proportional to live holds, not to all time.
CREATE INDEX IF NOT EXISTS idx_booking_holds_live_expires
  ON booking_holds (expires_at)
  WHERE released_at IS NULL AND converted_appointment_id IS NULL;
